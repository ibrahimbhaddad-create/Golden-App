// Technical indicators computed from our own price history.

export function sma(values: number[], n: number): number | null {
  if (values.length < n || n <= 0) return null;
  let s = 0;
  for (let i = values.length - n; i < values.length; i++) s += values[i];
  return s / n;
}

export function smaSeries(values: number[], n: number): (number | null)[] {
  const out: (number | null)[] = [];
  let s = 0;
  for (let i = 0; i < values.length; i++) {
    s += values[i];
    if (i >= n) s -= values[i - n];
    out.push(i >= n - 1 ? s / n : null);
  }
  return out;
}

/** Wilder's RSI. Needs at least n+1 values. */
export function rsi(values: number[], n = 14): number | null {
  if (values.length < n + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgG = gain / n;
  let avgL = loss / n;
  for (let i = n + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgG = (avgG * (n - 1) + Math.max(d, 0)) / n;
    avgL = (avgL * (n - 1) + Math.max(-d, 0)) / n;
  }
  if (avgL === 0) return avgG === 0 ? 50 : 100;
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
}

export interface HL {
  high: number;
  low: number;
}

/** Group nearby levels (within tolerance %) and average them. */
function cluster(levels: number[], tolPct: number): { level: number; touches: number }[] {
  const sorted = [...levels].sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const l of sorted) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(l - g[g.length - 1]) / l <= tolPct / 100) g.push(l);
    else groups.push([l]);
  }
  return groups.map((g) => ({ level: g.reduce((a, b) => a + b, 0) / g.length, touches: g.length }));
}

/**
 * Support / resistance from swing lows/highs (pivot with `k` bars on each
 * side), clustered. Nearest level below price = support, above = resistance.
 * Falls back to the range low/high.
 */
export function supportResistance(candles: HL[], price: number, k = 3, tolPct = 0.4) {
  if (candles.length === 0) return { support: null as number | null, resistance: null as number | null, levels: [] as { level: number; touches: number }[] };
  const lows: number[] = [];
  const highs: number[] = [];
  for (let i = k; i < candles.length - k; i++) {
    let isLow = true;
    let isHigh = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (candles[j].low < candles[i].low) isLow = false;
      if (candles[j].high > candles[i].high) isHigh = false;
    }
    if (isLow) lows.push(candles[i].low);
    if (isHigh) highs.push(candles[i].high);
  }
  const levels = cluster([...lows, ...highs], tolPct);
  const below = levels.filter((l) => l.level < price).sort((a, b) => b.level - a.level);
  const above = levels.filter((l) => l.level > price).sort((a, b) => a.level - b.level);
  const rangeLow = Math.min(...candles.map((c) => c.low));
  const rangeHigh = Math.max(...candles.map((c) => c.high));
  return {
    support: below[0]?.level ?? (rangeLow < price ? rangeLow : null),
    resistance: above[0]?.level ?? (rangeHigh > price ? rangeHigh : null),
    levels,
  };
}

export interface IndicatorSet {
  price: number;
  timeframe: "1h" | "1d";
  ma20: number | null;
  ma50: number | null;
  ma200: number | null;
  rsi14: number | null;
  changeDayPct: number | null;
  changeWeekPct: number | null;
  support: number | null;
  resistance: number | null;
  samples: number;
}

export type SignalKind = "buy" | "neutral" | "sell";

export interface Signal {
  kind: SignalKind;
  score: number;
  label: string;
  reasons: string[];
}

const fmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

/**
 * Rule-based reading. Positive score leans "buy", negative leans "sell".
 * Rules are intentionally simple and explained in Arabic.
 */
export function readSignal(ind: IndicatorSet, nearPct = 0.6): Signal {
  const reasons: string[] = [];
  let score = 0;
  const p = ind.price;

  if (ind.rsi14 != null) {
    if (ind.rsi14 < 30) {
      score += 2;
      reasons.push(`مؤشر RSI عند ${ind.rsi14.toFixed(1)} أي تحت 30 (منطقة تشبّع بيعي)`);
    } else if (ind.rsi14 > 70) {
      score -= 2;
      reasons.push(`مؤشر RSI عند ${ind.rsi14.toFixed(1)} أي فوق 70 (منطقة تشبّع شرائي)`);
    } else if (ind.rsi14 < 40) {
      score += 0.5;
      reasons.push(`مؤشر RSI منخفض نسبياً (${ind.rsi14.toFixed(1)})`);
    } else if (ind.rsi14 > 60) {
      score -= 0.5;
      reasons.push(`مؤشر RSI مرتفع نسبياً (${ind.rsi14.toFixed(1)})`);
    } else {
      reasons.push(`مؤشر RSI محايد (${ind.rsi14.toFixed(1)})`);
    }
  }

  if (ind.support != null && (p - ind.support) / p * 100 <= nearPct) {
    score += 1;
    reasons.push(`السعر قريب من مستوى دعم ${fmt(ind.support)} $`);
  }
  if (ind.resistance != null && (ind.resistance - p) / p * 100 <= nearPct) {
    score -= 1;
    reasons.push(`السعر قريب من مستوى مقاومة ${fmt(ind.resistance)} $`);
  }

  if (ind.ma50 != null && ind.ma200 != null) {
    if (ind.ma50 > ind.ma200) {
      score += 0.5;
      reasons.push("الاتجاه العام صاعد (متوسط 50 فوق متوسط 200)");
    } else {
      score -= 0.5;
      reasons.push("الاتجاه العام هابط (متوسط 50 تحت متوسط 200)");
    }
  }
  if (ind.ma20 != null) {
    const d = ((p - ind.ma20) / ind.ma20) * 100;
    if (d < -1.5) {
      score += 0.5;
      reasons.push(`السعر أدنى من متوسط 20 بنسبة ${Math.abs(d).toFixed(1)}%`);
    } else if (d > 1.5) {
      score -= 0.5;
      reasons.push(`السعر أعلى من متوسط 20 بنسبة ${d.toFixed(1)}%`);
    }
  }

  if (reasons.length === 0) reasons.push("لا توجد بيانات كافية بعد لبناء قراءة فنية");

  const kind: SignalKind = score >= 2 ? "buy" : score <= -2 ? "sell" : "neutral";
  const label = kind === "buy" ? "فرصة شراء محتملة" : kind === "sell" ? "فرصة بيع محتملة" : "محايد";
  return { kind, score, label, reasons };
}

export interface CloseCandle extends HL {
  close: number;
  bucket: string;
}

/** Build the indicator set from hourly + daily candles. */
export function computeIndicators(
  price: number,
  hourly: CloseCandle[],
  daily: CloseCandle[],
  opts: { prevDayClose?: number | null; weekAgoClose?: number | null } = {},
): IndicatorSet {
  // Prefer daily closes once we have enough history, otherwise hourly.
  const useDaily = daily.length >= 50;
  const series = (useDaily ? daily : hourly).map((c) => c.close);
  // The latest bucket is still forming: replace its close with the live price.
  if (series.length) series[series.length - 1] = price;
  const last30d = hourly.length >= 24 ? hourly : daily;
  const sr = supportResistance(last30d, price);
  const pc = (ref?: number | null) => (ref ? ((price - ref) / ref) * 100 : null);
  return {
    price,
    timeframe: useDaily ? "1d" : "1h",
    ma20: sma(series, 20),
    ma50: sma(series, 50),
    ma200: sma(series, 200),
    rsi14: rsi(series, 14),
    changeDayPct: pc(opts.prevDayClose),
    changeWeekPct: pc(opts.weekAgoClose),
    support: sr.support,
    resistance: sr.resistance,
    samples: series.length,
  };
}
