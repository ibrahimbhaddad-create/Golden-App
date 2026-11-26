import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { runAlerts } from "@/lib/server/alert-engine";
import { captureTick, getSettings, quoteFromTick, referencePrices } from "@/lib/server/prices";

/** One cron cycle: fetch price → store → evaluate alerts. */
export async function runTick() {
  const db = adminClient();
  const started = Date.now();
  const { tick, attempts } = await captureTick(db);
  if (!tick) return { ok: false as const, error: "all sources failed", attempts, ms: Date.now() - started };

  const now = new Date(tick.time);
  const [settings, ref] = await Promise.all([getSettings(db), referencePrices(db, now)]);
  const alerts = await runAlerts(db, { quote: quoteFromTick(tick, settings), settings, ref, now });
  return { ok: true as const, tick, attempts, alerts, ms: Date.now() - started };
}
