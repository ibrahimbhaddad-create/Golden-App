import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { karatTable, pctChange } from "@/lib/gold/calc";
import { adminClient } from "@/lib/supabase/admin";
import { captureTick, getLatestTick, getSettings, quoteFromTick, referencePrices, tickAtOrBefore } from "@/lib/server/prices";

const STALE_MS = 150_000;
let inflight: Promise<unknown> | null = null;

/**
 * Everything the home screen needs. If the cron hasn't stored a tick in the
 * last ~2.5 minutes, fetch one inline (single-flight per instance) so the app
 * still works before the scheduler is set up.
 */
export async function getPriceSnapshot(db: SupabaseClient) {
  let tick = await getLatestTick(db);
  if (!tick || Date.now() - new Date(tick.time).getTime() > STALE_MS) {
    try {
      inflight ??= captureTick(adminClient()).finally(() => (inflight = null));
      await inflight;
      tick = (await getLatestTick(db)) ?? tick;
    } catch (e) {
      console.error("inline capture failed", e);
    }
  }
  const settings = await getSettings(db);
  if (!tick) return { tick: null, settings };
  const now = new Date();
  const quote = quoteFromTick(tick, settings);
  const [ref, prev] = await Promise.all([referencePrices(db, now), tickAtOrBefore(db, new Date(now.getTime() - 24 * 3600_000), 180)]);
  const dayRef = ref.day_open ?? prev?.spot ?? null;
  return {
    tick,
    settings,
    quote,
    karats: karatTable(quote, settings),
    change: {
      dayOpen: ref.day_open,
      dayAbs: dayRef ? quote.spot - dayRef : null,
      dayPct: dayRef ? pctChange(dayRef, quote.spot) : null,
      h24Pct: prev ? pctChange(prev.spot, quote.spot) : null,
    },
    stale: Date.now() - new Date(tick.time).getTime() > 10 * 60_000,
  };
}

export type PriceSnapshot = Awaited<ReturnType<typeof getPriceSnapshot>>;
