import { describe, expect, it } from "vitest";
import { computeIndicators, readSignal, rsi, sma, smaSeries, supportResistance } from "@/lib/indicators";

describe("indicators", () => {
  it("sma", () => {
    expect(sma([1, 2, 3, 4, 5], 5)).toBe(3);
    expect(sma([1, 2, 3, 4, 5], 2)).toBe(4.5);
    expect(sma([1, 2], 3)).toBeNull();
    expect(smaSeries([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5]);
  });

  it("rsi matches the classic Wilder example", () => {
    // Data from Wilder / StockCharts RSI example (first RSI ≈ 70.53)
    const closes = [44.3389, 44.0902, 44.1497, 43.6124, 44.2778, 44.8264, 45.0955, 45.4245, 45.8433, 46.0826, 45.8931, 46.0328, 45.614, 46.282, 46.282];
    expect(rsi(closes, 14)!).toBeCloseTo(70.53, 1);
    expect(rsi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], 14)).toBe(100);
    expect(rsi([1, 2, 3], 14)).toBeNull();
  });

  it("finds nearest support and resistance", () => {
    const lows = [10, 9, 8, 9, 10, 11, 12, 11, 10, 9.5, 10, 11, 12, 13, 12, 11];
    const candles = lows.map((l) => ({ low: l, high: l + 1 }));
    const sr = supportResistance(candles, 11.5, 2);
    expect(sr.support).toBeCloseTo(9.5, 6);
    expect(sr.resistance).toBeCloseTo(13, 6);
  });

  it("signals buy when oversold near support, sell when overbought near resistance", () => {
    const buy = readSignal({ price: 100, timeframe: "1h", ma20: 103, ma50: 105, ma200: 100, rsi14: 25, changeDayPct: -2, changeWeekPct: -4, support: 99.7, resistance: 110, samples: 300 });
    expect(buy.kind).toBe("buy");
    expect(buy.label).toBe("فرصة شراء محتملة");
    expect(buy.reasons.join(" ")).toContain("RSI");
    expect(buy.reasons.join(" ")).toContain("دعم");

    const sell = readSignal({ price: 100, timeframe: "1h", ma20: 97, ma50: 95, ma200: 98, rsi14: 78, changeDayPct: 2, changeWeekPct: 4, support: 90, resistance: 100.3, samples: 300 });
    expect(sell.kind).toBe("sell");

    const neutral = readSignal({ price: 100, timeframe: "1h", ma20: 100, ma50: null, ma200: null, rsi14: 50, changeDayPct: 0, changeWeekPct: 0, support: 95, resistance: 105, samples: 30 });
    expect(neutral.kind).toBe("neutral");
  });

  it("computes from candles and falls back to hourly when daily history is short", () => {
    const hourly = Array.from({ length: 240 }, (_, i) => {
      const c = 2000 + Math.sin(i / 10) * 20;
      return { bucket: String(i), close: c, high: c + 2, low: c - 2 };
    });
    const ind = computeIndicators(2005, hourly, hourly.slice(0, 10), { prevDayClose: 2000, weekAgoClose: 1950 });
    expect(ind.timeframe).toBe("1h");
    expect(ind.ma200).not.toBeNull();
    expect(ind.rsi14).not.toBeNull();
    expect(ind.changeDayPct).toBeCloseTo(0.25, 6);
    expect(ind.changeWeekPct).toBeCloseTo((55 / 1950) * 100, 6);
  });
});
