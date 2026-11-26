import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, GRAMS_PER_OUNCE, karatTable, ounceToGramSar, shopPrice, toQuote, valueOf } from "@/lib/gold/calc";

describe("gold calculations", () => {
  it("converts ounce USD to SAR/gram by purity", () => {
    // 3110.35 USD/oz => 100 USD/g => 375 SAR/g (24k)
    expect(ounceToGramSar(GRAMS_PER_OUNCE * 100, 24, 3.75)).toBeCloseTo(375, 6);
    expect(ounceToGramSar(GRAMS_PER_OUNCE * 100, 22, 3.75)).toBeCloseTo(375 * 0.916, 6);
    expect(ounceToGramSar(GRAMS_PER_OUNCE * 100, 21, 3.75)).toBeCloseTo(375 * 0.875, 6);
    expect(ounceToGramSar(GRAMS_PER_OUNCE * 100, 18, 3.75)).toBeCloseTo(375 * 0.75, 6);
  });

  it("uses real bid/ask, or estimates them from spot", () => {
    expect(toQuote({ spot: 2000, bid: 1999, ask: 2001 }, 4)).toEqual({ spot: 2000, bid: 1999, ask: 2001, estimated: false });
    expect(toQuote({ spot: 2000, bid: null, ask: null }, 4)).toEqual({ spot: 2000, bid: 1998, ask: 2002, estimated: true });
  });

  it("builds the karat table with spread and shop price", () => {
    const q = toQuote({ spot: GRAMS_PER_OUNCE * 100, bid: GRAMS_PER_OUNCE * 99, ask: GRAMS_PER_OUNCE * 101 }, 0);
    const settings = { ...DEFAULT_SETTINGS, karats: { ...DEFAULT_SETTINGS.karats, "21": { making: 20, margin_pct: 5 } } };
    const row21 = karatTable(q, settings).find((r) => r.karat === 21)!;
    expect(row21.buy).toBeCloseTo(101 * 3.75 * 0.875, 6);
    expect(row21.sell).toBeCloseTo(99 * 3.75 * 0.875, 6);
    expect(row21.spread).toBeCloseTo(2 * 3.75 * 0.875, 6);
    expect(row21.shop).toBeCloseTo((row21.buy + 20) * 1.05, 6);
    expect(shopPrice(100, undefined)).toBe(100);
  });

  it("values a piece by weight", () => {
    const q = toQuote({ spot: GRAMS_PER_OUNCE * 100, bid: GRAMS_PER_OUNCE * 100, ask: GRAMS_PER_OUNCE * 100 }, 0);
    const v = valueOf(10, 18, q, DEFAULT_SETTINGS);
    expect(v.sell).toBeCloseTo(10 * 375 * 0.75, 6);
    expect(v.pureGrams).toBeCloseTo(7.5, 6);
    expect(v.shop).toBeCloseTo((375 * 0.75 + 25) * 10, 6);
  });
});
