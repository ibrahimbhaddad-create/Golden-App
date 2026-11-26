import { describe, expect, it } from "vitest";
import { fetchGoldPrice, nextHealth, sanityCheck, SourceError } from "@/lib/gold/sources";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function mockFetch(routes: Record<string, (() => Response | Promise<Response>)[]>) {
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const key = Object.keys(routes).find((k) => url.includes(k))!;
    const queue = routes[key];
    const next = queue.length > 1 ? queue.shift()! : queue[0];
    return next();
  }) as typeof fetch;
  return { f, calls };
}

const keys = { goldApiKey: "g", apiNinjasKey: "n" };
const fast = { retries: 1, backoffMs: 1, timeoutMs: 200 };

describe("price sources", () => {
  it("uses GoldAPI first with bid/ask", async () => {
    const { f, calls } = mockFetch({ goldapi: [() => json({ price: 2400, bid: 2399.5, ask: 2400.4, timestamp: 1700000000 })] });
    const r = await fetchGoldPrice({ keys, fetchImpl: f, ...fast });
    expect(r.quote).toMatchObject({ source: "goldapi", spot: 2400, bid: 2399.5, ask: 2400.4 });
    expect(calls).toHaveLength(1);
  });

  it("retries a 5xx once, then falls back to API Ninjas", async () => {
    const { f, calls } = mockFetch({
      goldapi: [() => json({ error: "x" }, 503)],
      "api-ninjas": [() => json({ price: 2401.2, updated: 1700000000 })],
    });
    const r = await fetchGoldPrice({ keys, fetchImpl: f, ...fast });
    expect(r.quote).toMatchObject({ source: "apininjas", spot: 2401.2, bid: null });
    expect(calls.filter((c) => c.includes("goldapi.io"))).toHaveLength(2);
    expect(r.attempts.map((a) => [a.source, a.ok])).toEqual([["goldapi", false], ["apininjas", true]]);
  });

  it("does not retry auth/quota errors, and pauses that source", async () => {
    const { f, calls } = mockFetch({
      goldapi: [() => json({ error: "quota" }, 429)],
      "api-ninjas": [() => json({ error: "bad key" }, 401)],
      "gold-api.com": [() => json({ price: 2399.9, updatedAt: "2026-01-01T00:00:00Z" })],
    });
    const now = new Date("2026-01-01T00:00:00Z");
    const r = await fetchGoldPrice({ keys, fetchImpl: f, ...fast, now: () => now });
    expect(r.quote?.source).toBe("goldapicom");
    expect(calls.filter((c) => c.includes("goldapi.io"))).toHaveLength(1);
    const g = r.health.find((h) => h.source === "goldapi")!;
    expect(new Date(g.disabled_until!).getTime() - now.getTime()).toBe(30 * 60_000);

    // next run skips paused sources
    const second = mockFetch({ "gold-api.com": [() => json({ price: 2400 })], goldapi: [() => json({ price: 1 })] });
    const r2 = await fetchGoldPrice({ keys, fetchImpl: second.f, ...fast, health: r.health, now: () => now });
    expect(r2.quote?.source).toBe("goldapicom");
    expect(second.calls).toHaveLength(1);
  });

  it("skips sources without keys and handles network errors / timeouts", async () => {
    const { f } = mockFetch({
      "gold-api.com": [
        () => {
          throw new TypeError("fetch failed");
        },
        () => json({ price: 2410 }),
      ],
    });
    const r = await fetchGoldPrice({ keys: {}, fetchImpl: f, ...fast });
    expect(r.quote).toMatchObject({ source: "goldapicom", spot: 2410 });
  });

  it("rejects insane values and returns null when everything fails", async () => {
    const { f } = mockFetch({ "gold-api.com": [() => json({ price: 24.1 })] });
    const r = await fetchGoldPrice({ keys: {}, fetchImpl: f, ...fast });
    expect(r.quote).toBeNull();
    expect(r.attempts[0].error).toMatch(/sanity/);
    expect(sanityCheck({ spot: 2000, bid: null, ask: null, source: "goldapicom" }, 2500)).toMatch(/jump/);
    expect(sanityCheck({ spot: 2000, bid: 2001, ask: 2000, source: "goldapi" })).toBe("bid > ask");
  });

  it("circuit breaker backs off after repeated failures and resets on success", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    let h = nextHealth(undefined, "x", now, new SourceError("boom", 500));
    h = nextHealth(h, "x", now, new SourceError("boom", 500));
    expect(h.disabled_until).toBeNull();
    h = nextHealth(h, "x", now, new SourceError("boom", 500));
    expect(h.consecutive_failures).toBe(3);
    expect(new Date(h.disabled_until!).getTime() - now.getTime()).toBe(5 * 60_000);
    h = nextHealth(h, "x", now);
    expect(h.consecutive_failures).toBe(0);
    expect(h.disabled_until).toBeNull();
  });
});
