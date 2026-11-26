// Hits the real price APIs. Run with: LIVE=1 npx vitest run tests/live.test.ts
import { describe, expect, it } from "vitest";
import { fetchGoldPrice } from "@/lib/gold/sources";

describe.runIf(process.env.LIVE === "1")("live price sources", () => {
  it("fetches a real XAU/USD price through the fallback chain", async () => {
    const r = await fetchGoldPrice({
      keys: { goldApiKey: process.env.GOLDAPI_KEY, apiNinjasKey: process.env.API_NINJAS_KEY },
    });
    console.log(JSON.stringify(r, null, 2));
    expect(r.quote).not.toBeNull();
    expect(r.quote!.spot).toBeGreaterThan(500);
  }, 30_000);

  it("falls through invalid keys to the keyless source", async () => {
    const r = await fetchGoldPrice({ keys: { goldApiKey: "invalid", apiNinjasKey: "invalid" } });
    console.log(JSON.stringify(r.attempts));
    expect(r.quote?.source).toBe("goldapicom");
    expect(r.health.find((h) => h.source === "goldapi")?.disabled_until).toBeTruthy();
  }, 30_000);
});
