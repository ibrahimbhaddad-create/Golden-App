import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_SETTINGS, toQuote } from "@/lib/gold/calc";
import { fetchGoldPrice, type SourceHealth } from "@/lib/gold/sources";
import { serverEnv } from "@/lib/env";
import { startOfDayInTz } from "@/lib/time";
import type { ChangeWindow, PriceTick, Settings } from "@/lib/types";

export async function getSettings(db: SupabaseClient): Promise<Settings> {
  const { data } = await db.from("settings").select("usd_sar,karats,fallback_spread_usd,ai_summary_enabled,updated_at").eq("id", 1).maybeSingle();
  if (!data) return DEFAULT_SETTINGS;
  return {
    usd_sar: Number(data.usd_sar),
    karats: { ...DEFAULT_SETTINGS.karats, ...(data.karats as Settings["karats"]) },
    fallback_spread_usd: Number(data.fallback_spread_usd),
    ai_summary_enabled: !!data.ai_summary_enabled,
    updated_at: data.updated_at,
  };
}

const toTick = (r: Record<string, unknown>): PriceTick => ({
  id: Number(r.id),
  time: String(r.time),
  spot: Number(r.spot),
  bid: r.bid == null ? null : Number(r.bid),
  ask: r.ask == null ? null : Number(r.ask),
  source: String(r.source),
});

export async function getLatestTick(db: SupabaseClient): Promise<PriceTick | null> {
  const { data } = await db.from("price_ticks").select("*").order("time", { ascending: false }).limit(1).maybeSingle();
  return data ? toTick(data) : null;
}

/** Last tick at or before `at` (within `maxAgeMin` of it). */
export async function tickAtOrBefore(db: SupabaseClient, at: Date, maxAgeMin = 90): Promise<PriceTick | null> {
  const { data } = await db
    .from("price_ticks")
    .select("*")
    .lte("time", at.toISOString())
    .gte("time", new Date(at.getTime() - maxAgeMin * 60_000).toISOString())
    .order("time", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? toTick(data) : null;
}

export async function firstTickSince(db: SupabaseClient, since: Date): Promise<PriceTick | null> {
  const { data } = await db
    .from("price_ticks")
    .select("*")
    .gte("time", since.toISOString())
    .order("time", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data ? toTick(data) : null;
}

/** Reference prices for % change: 1h ago, 24h ago, today's open (local tz). */
export async function referencePrices(db: SupabaseClient, now: Date): Promise<Record<ChangeWindow, number | null>> {
  const tz = serverEnv.timezone();
  const [h1, h24, open] = await Promise.all([
    tickAtOrBefore(db, new Date(now.getTime() - 3600_000), 30),
    tickAtOrBefore(db, new Date(now.getTime() - 24 * 3600_000), 120),
    firstTickSince(db, startOfDayInTz(now, tz)),
  ]);
  return { "1h": h1?.spot ?? null, "24h": h24?.spot ?? null, day_open: open?.spot ?? null };
}

/** Fetch from the sources (with fallback) and store a tick. */
export async function captureTick(db: SupabaseClient) {
  const [{ data: health }, last] = await Promise.all([db.from("source_health").select("*"), getLatestTick(db)]);
  const lastIsRecent = last && Date.now() - new Date(last.time).getTime() < 6 * 3600_000;
  const result = await fetchGoldPrice({
    keys: {
      goldApiKey: serverEnv.goldApiKey(),
      apiNinjasKey: serverEnv.apiNinjasKey(),
      apiNinjasUrl: process.env.API_NINJAS_URL,
    },
    health: (health ?? []) as SourceHealth[],
    lastSpot: lastIsRecent ? last.spot : null,
  });
  if (result.health.length) {
    await db.from("source_health").upsert(result.health, { onConflict: "source" });
  }
  if (!result.quote) return { tick: null, attempts: result.attempts };

  const { data, error } = await db
    .from("price_ticks")
    .insert({ spot: result.quote.spot, bid: result.quote.bid, ask: result.quote.ask, source: result.quote.source })
    .select("*")
    .single();
  if (error) throw new Error("insert tick failed: " + error.message);
  return { tick: toTick(data), attempts: result.attempts };
}

export function quoteFromTick(t: PriceTick, s: Settings) {
  return toQuote(t, s.fallback_spread_usd);
}
