import { describe, expect, it } from "vitest";
import { evaluateAlert, type Snapshot } from "@/lib/alerts/evaluate";
import { DEFAULT_SETTINGS, GRAMS_PER_OUNCE } from "@/lib/gold/calc";
import type { Alert } from "@/lib/types";

const now = new Date("2026-03-01T10:00:00Z");
const snap: Snapshot = {
  quote: { spot: 2000, bid: 1999, ask: 2001, estimated: false },
  settings: DEFAULT_SETTINGS,
  ref: { "1h": 2010, "24h": 2050, day_open: 1990 },
  now,
};

const base: Alert = {
  id: "a",
  user_id: "u",
  type: "ounce_price",
  direction: "above",
  threshold: 1990,
  karat: null,
  price_side: "spot",
  change_window: null,
  mode: "once",
  cooldown_minutes: 60,
  channels: ["push"],
  active: true,
  note: null,
  last_triggered_at: null,
  trigger_count: 0,
  created_at: now.toISOString(),
};

describe("alert evaluation", () => {
  it("ounce above/below", () => {
    expect(evaluateAlert(base, snap).fire).toBe(true);
    expect(evaluateAlert({ ...base, threshold: 2001 }, snap).fire).toBe(false);
    expect(evaluateAlert({ ...base, direction: "below", threshold: 2001 }, snap).fire).toBe(true);
  });

  it("gram price by karat and side", () => {
    const ask21 = (2001 / GRAMS_PER_OUNCE) * 0.875 * 3.75; // ≈ 211.13
    const a: Alert = { ...base, type: "gram_price", karat: 21, price_side: "ask", direction: "above", threshold: 211 };
    const e = evaluateAlert(a, snap);
    expect(e.fire).toBe(true);
    expect(e.value).toBeCloseTo(ask21, 6);
    expect(e.title).toContain("عيار 21");
    expect(evaluateAlert({ ...a, threshold: 212 }, snap).fire).toBe(false);
  });

  it("percent change windows", () => {
    const drop: Alert = { ...base, type: "pct_change", direction: "below", threshold: 2, change_window: "24h" };
    // 2050 -> 2000 = -2.44%
    expect(evaluateAlert(drop, snap).fire).toBe(true);
    expect(evaluateAlert({ ...drop, threshold: 3 }, snap).fire).toBe(false);
    // 1h: 2010 -> 2000 = -0.5%
    expect(evaluateAlert({ ...drop, threshold: 0.4, change_window: "1h" }, snap).fire).toBe(true);
    // day open 1990 -> 2000 = +0.5% rise
    const rise: Alert = { ...drop, direction: "above", threshold: 0.5, change_window: "day_open" };
    expect(evaluateAlert(rise, snap).fire).toBe(true);
    expect(evaluateAlert({ ...rise, change_window: "24h" }, snap).fire).toBe(false);
    expect(evaluateAlert(rise, { ...snap, ref: { ...snap.ref, day_open: null } }).reason).toBe("no-data");
  });

  it("respects cooldown and active flag", () => {
    const recent = new Date(now.getTime() - 30 * 60_000).toISOString();
    expect(evaluateAlert({ ...base, last_triggered_at: recent }, snap).reason).toBe("cooldown");
    expect(evaluateAlert({ ...base, last_triggered_at: recent, cooldown_minutes: 15 }, snap).fire).toBe(true);
    expect(evaluateAlert({ ...base, active: false }, snap).reason).toBe("inactive");
  });
});
