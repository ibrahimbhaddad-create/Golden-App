import { ounceToGramSar, pctChange, type Quote } from "@/lib/gold/calc";
import { fmt, fmtPct } from "@/lib/format";
import type { Alert, ChangeWindow, Settings } from "@/lib/types";

export interface Snapshot {
  quote: Quote;
  settings: Settings;
  /** reference spot prices for % change alerts */
  ref: Record<ChangeWindow, number | null>;
  now: Date;
}

export interface Evaluation {
  fire: boolean;
  value: number | null;
  title: string;
  body: string;
  reason?: "inactive" | "cooldown" | "no-data" | "condition";
}

export const WINDOW_LABEL: Record<ChangeWindow, string> = {
  "1h": "خلال ساعة",
  "24h": "خلال 24 ساعة",
  day_open: "منذ افتتاح اليوم",
};
export const SIDE_LABEL = { ask: "شراء", bid: "بيع", spot: "السعر الفوري" } as const;

export function inCooldown(alert: Pick<Alert, "last_triggered_at" | "cooldown_minutes">, now: Date) {
  if (!alert.last_triggered_at) return false;
  return now.getTime() - new Date(alert.last_triggered_at).getTime() < alert.cooldown_minutes * 60_000;
}

/** Current observed value for an alert (USD/oz, SAR/g, or % change). */
export function observedValue(alert: Alert, s: Snapshot): number | null {
  const side = alert.price_side ?? "spot";
  const px = s.quote[side];
  switch (alert.type) {
    case "ounce_price":
      return px;
    case "gram_price":
      return alert.karat ? ounceToGramSar(px, alert.karat, s.settings.usd_sar) : null;
    case "pct_change": {
      const ref = alert.change_window ? s.ref[alert.change_window] : null;
      return ref ? pctChange(ref, s.quote.spot) : null;
    }
  }
}

export function conditionMet(alert: Alert, value: number): boolean {
  if (alert.type === "pct_change") {
    return alert.direction === "above" ? value >= alert.threshold : value <= -alert.threshold;
  }
  return alert.direction === "above" ? value >= alert.threshold : value <= alert.threshold;
}

export function describeAlert(alert: Pick<Alert, "type" | "direction" | "threshold" | "karat" | "price_side" | "change_window">): string {
  const dir = alert.direction === "above" ? "أعلى من" : "أقل من";
  switch (alert.type) {
    case "ounce_price":
      return `الأونصة ${dir} ${fmt(alert.threshold)} $`;
    case "gram_price":
      return `غرام عيار ${alert.karat} (${SIDE_LABEL[alert.price_side]}) ${dir} ${fmt(alert.threshold)} ر.س`;
    case "pct_change":
      return `${alert.direction === "above" ? "صعود" : "هبوط"} ${fmt(alert.threshold)}% ${WINDOW_LABEL[alert.change_window ?? "24h"]}`;
  }
}

export function evaluateAlert(alert: Alert, s: Snapshot): Evaluation {
  const empty = { title: "", body: "" };
  if (!alert.active) return { fire: false, value: null, reason: "inactive", ...empty };
  if (inCooldown(alert, s.now)) return { fire: false, value: null, reason: "cooldown", ...empty };
  const value = observedValue(alert, s);
  if (value == null || !Number.isFinite(value)) return { fire: false, value: null, reason: "no-data", ...empty };
  if (!conditionMet(alert, value)) return { fire: false, value, reason: "condition", ...empty };

  let title: string;
  let body: string;
  if (alert.type === "ounce_price") {
    title = `${alert.direction === "above" ? "📈" : "📉"} ${describeAlert(alert)}`;
    body = `سعر الأونصة الآن ${fmt(value)} $`;
  } else if (alert.type === "gram_price") {
    title = `${alert.direction === "above" ? "📈" : "📉"} ${describeAlert(alert)}`;
    body = `سعر غرام عيار ${alert.karat} الآن ${fmt(value)} ر.س`;
  } else {
    const ref = s.ref[alert.change_window!]!;
    title = `${alert.direction === "above" ? "📈" : "📉"} ${describeAlert(alert)}`;
    body = `تغيّر السعر ${fmtPct(value)} (من ${fmt(ref)} إلى ${fmt(s.quote.spot)} $)`;
  }
  if (alert.note) body += ` — ${alert.note}`;
  return { fire: true, value, title, body };
}
