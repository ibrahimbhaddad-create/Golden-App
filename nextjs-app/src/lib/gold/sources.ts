// Price sources with ordered fallback, retry with backoff, sanity checks and a
// per-source circuit breaker. Pure logic here; persistence lives in
// src/lib/server/prices.ts so this module is easy to unit-test.

export type SourceId = "goldapi" | "apininjas" | "goldapicom";

export interface RawQuote {
  spot: number;
  bid: number | null;
  ask: number | null;
  source: SourceId;
  sourceTime?: string;
}

export interface SourceHealth {
  source: string;
  consecutive_failures: number;
  disabled_until: string | null;
  last_error: string | null;
  last_success_at: string | null;
  last_attempt_at: string | null;
}

export class SourceError extends Error {
  constructor(
    message: string,
    public status?: number,
    public retryable = true,
  ) {
    super(message);
  }
}

type FetchFn = typeof fetch;

interface SourceDef {
  id: SourceId;
  label: string;
  enabled: (keys: SourceKeys) => boolean;
  fetchQuote: (f: FetchFn, keys: SourceKeys, signal: AbortSignal) => Promise<RawQuote>;
}

export interface SourceKeys {
  goldApiKey?: string;
  apiNinjasKey?: string;
  apiNinjasUrl?: string;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

async function getJson(f: FetchFn, url: string, headers: Record<string, string>, signal: AbortSignal) {
  let res: Response;
  try {
    res = await f(url, { headers: { Accept: "application/json", ...headers }, signal, cache: "no-store" });
  } catch (e) {
    throw new SourceError(`network: ${(e as Error).message}`);
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 160);
    // 4xx (except 408/429) won't be fixed by retrying right away.
    const retryable = res.status >= 500 || res.status === 408;
    throw new SourceError(`HTTP ${res.status} ${body}`.trim(), res.status, retryable);
  }
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    throw new SourceError("invalid JSON");
  }
}

export const SOURCES: SourceDef[] = [
  {
    id: "goldapi",
    label: "GoldAPI.io",
    enabled: (k) => !!k.goldApiKey,
    async fetchQuote(f, k, signal) {
      const j = await getJson(f, "https://www.goldapi.io/api/XAU/USD", { "x-access-token": k.goldApiKey! }, signal);
      const spot = num(j.price);
      if (!spot) throw new SourceError("missing price", undefined, false);
      const ts = num(j.timestamp);
      return {
        spot,
        bid: num(j.bid),
        ask: num(j.ask),
        source: "goldapi",
        sourceTime: ts ? new Date(ts * 1000).toISOString() : undefined,
      };
    },
  },
  {
    id: "apininjas",
    label: "API Ninjas",
    enabled: (k) => !!k.apiNinjasKey,
    async fetchQuote(f, k, signal) {
      const url = k.apiNinjasUrl || "https://api.api-ninjas.com/v1/goldprice";
      const j = await getJson(f, url, { "X-Api-Key": k.apiNinjasKey! }, signal);
      const spot = num(j.price) ?? num(j.spot) ?? num(j.value);
      if (!spot) throw new SourceError("missing price", undefined, false);
      const ts = num(j.updated) ?? num(j.timestamp);
      return {
        spot,
        bid: null,
        ask: null,
        source: "apininjas",
        sourceTime: ts ? new Date(ts * 1000).toISOString() : undefined,
      };
    },
  },
  {
    id: "goldapicom",
    label: "gold-api.com",
    enabled: () => true,
    async fetchQuote(f, _k, signal) {
      const j = await getJson(f, "https://api.gold-api.com/price/XAU", {}, signal);
      const spot = num(j.price);
      if (!spot) throw new SourceError("missing price", undefined, false);
      return { spot, bid: null, ask: null, source: "goldapicom", sourceTime: (j.updatedAt as string) ?? undefined };
    },
  },
];

/** Reject obviously broken data (bad units, zeros, huge jumps). */
export function sanityCheck(q: RawQuote, lastSpot?: number | null): string | null {
  if (q.spot < 300 || q.spot > 100_000) return `spot out of range: ${q.spot}`;
  if (q.bid != null && q.ask != null) {
    if (q.bid > q.ask) return "bid > ask";
    if ((q.ask - q.bid) / q.spot > 0.02) return "spread too wide";
  }
  if (lastSpot && Math.abs(q.spot - lastSpot) / lastSpot > 0.15) return `jump >15% vs last (${lastSpot})`;
  return null;
}

/** Circuit-breaker bookkeeping (pure). */
export function nextHealth(prev: SourceHealth | undefined, source: string, now: Date, err?: SourceError): SourceHealth {
  const base: SourceHealth = prev ?? {
    source,
    consecutive_failures: 0,
    disabled_until: null,
    last_error: null,
    last_success_at: null,
    last_attempt_at: null,
  };
  if (!err) {
    return { ...base, consecutive_failures: 0, disabled_until: null, last_success_at: now.toISOString(), last_attempt_at: now.toISOString() };
  }
  const failures = base.consecutive_failures + 1;
  let pauseMin = 0;
  if ([400, 401, 403, 429].includes(err.status ?? 0)) pauseMin = 30; // bad key / quota
  else if (failures >= 3) pauseMin = Math.min(5 * (failures - 2), 30);
  return {
    ...base,
    consecutive_failures: failures,
    last_error: err.message.slice(0, 300),
    last_attempt_at: now.toISOString(),
    disabled_until: pauseMin ? new Date(now.getTime() + pauseMin * 60_000).toISOString() : null,
  };
}

export function isPaused(h: SourceHealth | undefined, now: Date) {
  return !!h?.disabled_until && new Date(h.disabled_until) > now;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface FetchResult {
  quote: RawQuote | null;
  attempts: { source: SourceId; ok: boolean; error?: string; skipped?: string }[];
  health: SourceHealth[];
}

/**
 * Try each source in order. Each source gets up to `retries + 1` attempts with
 * exponential backoff for retryable errors. Paused sources are skipped, unless
 * every source is paused (then we try anyway rather than return nothing).
 */
export async function fetchGoldPrice(opts: {
  keys: SourceKeys;
  health?: SourceHealth[];
  lastSpot?: number | null;
  fetchImpl?: FetchFn;
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
  now?: () => Date;
}): Promise<FetchResult> {
  const f = opts.fetchImpl ?? fetch;
  const now = opts.now ?? (() => new Date());
  const retries = opts.retries ?? 1;
  const backoff = opts.backoffMs ?? 400;
  const healthMap = new Map((opts.health ?? []).map((h) => [h.source, h]));
  const attempts: FetchResult["attempts"] = [];
  const touched = new Map<string, SourceHealth>();

  const enabled = SOURCES.filter((s) => s.enabled(opts.keys));
  const allPaused = enabled.every((s) => isPaused(healthMap.get(s.id), now()));

  for (const src of enabled) {
    if (!allPaused && isPaused(healthMap.get(src.id), now())) {
      attempts.push({ source: src.id, ok: false, skipped: "paused" });
      continue;
    }
    let lastErr: SourceError | undefined;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await sleep(backoff * 2 ** (attempt - 1));
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 6000);
      try {
        const q = await src.fetchQuote(f, opts.keys, ctrl.signal);
        const bad = sanityCheck(q, opts.lastSpot);
        if (bad) throw new SourceError(`sanity: ${bad}`, undefined, false);
        const h = nextHealth(healthMap.get(src.id), src.id, now());
        touched.set(src.id, h);
        attempts.push({ source: src.id, ok: true });
        return { quote: q, attempts, health: [...touched.values()] };
      } catch (e) {
        lastErr = e instanceof SourceError ? e : new SourceError((e as Error).message);
        if (!lastErr.retryable) break;
      } finally {
        clearTimeout(timer);
      }
    }
    const h = nextHealth(healthMap.get(src.id), src.id, now(), lastErr);
    healthMap.set(src.id, h);
    touched.set(src.id, h);
    attempts.push({ source: src.id, ok: false, error: lastErr?.message });
  }
  return { quote: null, attempts, health: [...touched.values()] };
}
