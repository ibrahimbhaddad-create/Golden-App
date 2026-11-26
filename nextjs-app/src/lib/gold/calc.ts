import type { Karat, KaratConfig, PriceTick, Settings } from "@/lib/types";

export const GRAMS_PER_OUNCE = 31.1035;
export const KARATS: Karat[] = [24, 22, 21, 18];
export const KARAT_PURITY: Record<Karat, number> = { 24: 1, 22: 0.916, 21: 0.875, 18: 0.75 };

export const DEFAULT_SETTINGS: Settings = {
  usd_sar: 3.75,
  karats: {
    "24": { making: 0, margin_pct: 0 },
    "22": { making: 15, margin_pct: 0 },
    "21": { making: 20, margin_pct: 0 },
    "18": { making: 25, margin_pct: 0 },
  },
  fallback_spread_usd: 1,
  ai_summary_enabled: false,
};

export interface Quote {
  spot: number;
  bid: number;
  ask: number;
  /** true when bid/ask were estimated from spot + fallback spread */
  estimated: boolean;
}

/** Fill bid/ask from spot when the source only gave spot. */
export function toQuote(t: Pick<PriceTick, "spot" | "bid" | "ask">, fallbackSpreadUsd: number): Quote {
  const spot = Number(t.spot);
  const bid = t.bid != null ? Number(t.bid) : null;
  const ask = t.ask != null ? Number(t.ask) : null;
  if (bid != null && ask != null && ask >= bid) return { spot, bid, ask, estimated: false };
  const half = fallbackSpreadUsd / 2;
  return { spot, bid: spot - half, ask: spot + half, estimated: true };
}

/** USD/oz → SAR per gram of the given karat. */
export function ounceToGramSar(usdPerOunce: number, karat: Karat, usdSar: number): number {
  return (usdPerOunce / GRAMS_PER_OUNCE) * KARAT_PURITY[karat] * usdSar;
}

export interface KaratRow {
  karat: Karat;
  buy: number; // what you pay (ask) SAR/g
  sell: number; // what you get (bid) SAR/g
  spread: number; // buy - sell
  spot: number; // SAR/g at spot
  shop: number; // estimated retail price SAR/g
}

export function shopPrice(askPerGram: number, cfg: KaratConfig | undefined): number {
  const making = Number(cfg?.making ?? 0);
  const margin = Number(cfg?.margin_pct ?? 0);
  return (askPerGram + making) * (1 + margin / 100);
}

export function karatTable(q: Quote, settings: Settings): KaratRow[] {
  return KARATS.map((k) => {
    const buy = ounceToGramSar(q.ask, k, settings.usd_sar);
    const sell = ounceToGramSar(q.bid, k, settings.usd_sar);
    return {
      karat: k,
      buy,
      sell,
      spread: buy - sell,
      spot: ounceToGramSar(q.spot, k, settings.usd_sar),
      shop: shopPrice(buy, settings.karats[String(k)]),
    };
  });
}

/** Value of a piece of gold of `grams` weight. */
export function valueOf(grams: number, karat: Karat, q: Quote, settings: Settings) {
  const row = karatTable(q, settings).find((r) => r.karat === karat)!;
  return {
    sell: row.sell * grams, // what a dealer pays you (bid)
    buy: row.buy * grams, // raw metal cost (ask)
    shop: row.shop * grams, // estimated shop price incl. making + margin
    pureGrams: grams * KARAT_PURITY[karat],
  };
}

export function pctChange(from: number, to: number): number {
  if (!from) return 0;
  return ((to - from) / from) * 100;
}
