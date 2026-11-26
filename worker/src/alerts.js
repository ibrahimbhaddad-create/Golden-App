// Alert evaluation on the server — mirrors the app's logic (app.js).

export const OZ = 31.1035;
export const USD_SAR = 3.75;
export const ITEMS = {
  g24: { metal: "gold", label: "عيار 24", purity: 24 / 24 },
  g22: { metal: "gold", label: "عيار 22", purity: 22 / 24 },
  g21: { metal: "gold", label: "عيار 21", purity: 21 / 24 },
  g18: { metal: "gold", label: "عيار 18", purity: 18 / 24 },
  s999: { metal: "silver", label: "فضة 999", purity: 0.999 },
  s925: { metal: "silver", label: "فضة 925", purity: 0.925 },
};
export const UNITS = {
  SAR: "ريال", AED: "درهم", KWD: "د.ك", QAR: "ر.ق", BHD: "د.ب", OMR: "ر.ع", JOD: "دينار",
  IQD: "د.ع", EGP: "جنيه", USD: "دولار", EUR: "يورو", GBP: "إسترليني", TRY: "ليرة",
};
const METAL_NAME = { gold: "الذهب", silver: "الفضة" };
const REPEATS = [0, 15, 60, 180, 1440];
export const MAX_ALERTS = 50;

const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—");
const digits = (c) => (c === "IQD" ? 0 : 2);
const signed = (v) => (Number.isFinite(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmt(Math.abs(v))}%` : "—");

export function rate(prices, c) {
  if (c === "USD") return 1;
  if (c === "SAR") return USD_SAR;
  const r = Number(prices.rates?.[c]);
  return r > 0 ? r : NaN;
}

export function gramPrice(prices, itemId, c) {
  const it = ITEMS[itemId];
  const oz = it.metal === "silver" ? prices.silver : prices.gold;
  return (oz / OZ) * it.purity * rate(prices, c);
}

/** UTC instant of local midnight in `tz` for the day containing `date`. */
export function startOfDay(date, tz) {
  const off = (d) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
        .formatToParts(d)
        .map((x) => [x.type, x.value]),
    );
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(d.getTime() / 1000) * 1000;
  };
  try {
    const o = off(date);
    const local = new Date(date.getTime() + o);
    const midLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
    return new Date(midLocal - off(new Date(midLocal - o)));
  } catch {
    return startOfDay(date, "Asia/Riyadh");
  }
}

/** % change of gold since the first sample after local midnight (24h fallback). */
export function dayChangePct(points, price, tz, now = new Date()) {
  if (!points?.length || !price) return NaN;
  const cut = startOfDay(now, tz).getTime() / 1000;
  const open = points.find((p) => p.t >= cut) ?? points.find((p) => p.t >= now.getTime() / 1000 - 86400) ?? points[0];
  return ((price - open.p) / open.p) * 100;
}

/** Validate/normalise an alert coming from the app. */
export function normAlert(a) {
  if (!a || typeof a !== "object") return null;
  const kind = ["gram", "ounce", "pct"].includes(a.kind) ? a.kind : null;
  const value = Number(a.value);
  if (!kind || !(value > 0) || value > 1e9) return null;
  if (kind === "gram" && !ITEMS[a.item]) return null;
  if (kind === "pct" && value >= 100) return null;
  const id = typeof a.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(a.id) ? a.id : null;
  if (!id) return null;
  const ts = (v) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
  return {
    id,
    kind,
    item: kind === "gram" ? a.item : null,
    metal: kind === "ounce" ? (a.metal === "silver" ? "silver" : "gold") : kind === "pct" ? "gold" : ITEMS[a.item].metal,
    dir: a.dir === "below" ? "below" : "above",
    value,
    currency: kind === "gram" && UNITS[a.currency] ? a.currency : kind === "gram" ? "SAR" : "USD",
    repeat: REPEATS.includes(Number(a.repeat)) ? Number(a.repeat) : 0,
    triggeredAt: ts(a.triggeredAt),
    triggeredValue: Number.isFinite(Number(a.triggeredValue)) && a.triggeredValue !== null ? Number(a.triggeredValue) : null,
    lastFiredAt: ts(a.lastFiredAt),
    rearmedAt: ts(a.rearmedAt),
    count: Math.max(0, Math.floor(Number(a.count) || 0)),
  };
}

/**
 * Merge firing state between the app (incoming) and the server (stored):
 * whichever side acted last wins. Re-arming on the device sets `rearmedAt`,
 * which beats an older firing recorded on the server.
 */
export function mergeState(incoming, stored) {
  if (!stored) return incoming;
  const sameRule = ["kind", "item", "metal", "dir", "value", "currency", "repeat"].every((k) => incoming[k] === stored[k]);
  if (!sameRule) return incoming;
  const t = (v) => (v ? Date.parse(v) : 0);
  const tIn = Math.max(t(incoming.lastFiredAt), t(incoming.rearmedAt));
  if (t(stored.lastFiredAt) <= tIn) return incoming;
  return { ...incoming, triggeredAt: stored.triggeredAt, triggeredValue: stored.triggeredValue, lastFiredAt: stored.lastFiredAt, count: Math.max(incoming.count, stored.count) };
}

export function describe(a) {
  if (a.kind === "gram") return `${ITEMS[a.item].label} ${a.dir === "above" ? "أعلى من" : "أقل من"} ${fmt(a.value, digits(a.currency))} ${UNITS[a.currency]}`;
  if (a.kind === "ounce") return `أونصة ${METAL_NAME[a.metal]} ${a.dir === "above" ? "أعلى من" : "أقل من"} $${fmt(a.value)}`;
  return `${a.dir === "above" ? "صعود" : "نزول"} الذهب ${fmt(a.value)}% اليوم`;
}

/**
 * Evaluate one alert. Mutates its firing state when it fires and returns the
 * notification, or null.
 */
export function evaluate(a, ctx, now = new Date()) {
  if (!a.repeat && a.triggeredAt) return null;
  if (a.repeat && a.lastFiredAt && now.getTime() - Date.parse(a.lastFiredAt) < a.repeat * 60_000) return null;
  let v;
  if (a.kind === "gram") v = gramPrice(ctx.prices, a.item, a.currency);
  else if (a.kind === "ounce") v = a.metal === "silver" ? ctx.prices.silver : ctx.prices.gold;
  else v = dayChangePct(ctx.points, ctx.prices.gold, ctx.tz, now);
  if (!Number.isFinite(v)) return null;
  const hit = a.kind === "pct" ? (a.dir === "above" ? v >= a.value : v <= -a.value) : a.dir === "above" ? v >= a.value : v <= a.value;
  if (!hit) return null;
  const at = now.toISOString();
  a.lastFiredAt = at;
  a.count += 1;
  a.triggeredValue = v;
  if (!a.repeat) a.triggeredAt = at;
  const line =
    a.kind === "pct"
      ? `تغيّر الذهب اليوم ${signed(v)}`
      : a.kind === "gram"
        ? `سعر الجرام الآن ${fmt(v, digits(a.currency))} ${UNITS[a.currency]}`
        : `سعر الأونصة الآن $${fmt(v)}`;
  return { title: `🔔 ${describe(a)}`, body: line, tag: `alert-${a.id}` };
}
