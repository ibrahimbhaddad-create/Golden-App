import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeIndicators, readSignal, type CloseCandle } from "@/lib/indicators";
import { serverEnv } from "@/lib/env";
import { dayOriginIso, startOfDayInTz } from "@/lib/time";
import { getLatestTick } from "@/lib/server/prices";
import type { Candle } from "@/lib/types";

export async function getCandles(db: SupabaseClient, bucket: string, since: Date): Promise<Candle[]> {
  const { data, error } = await db.rpc("price_candles", {
    p_bucket: bucket,
    p_since: since.toISOString(),
    p_until: new Date(Date.now() + 60_000).toISOString(),
    p_origin: dayOriginIso(serverEnv.timezone()),
  });
  if (error) throw new Error("candles: " + error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    bucket: String(r.bucket),
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    n: Number(r.n),
  }));
}

/** Full technical reading from our own price history. */
export async function getMarketReading(db: SupabaseClient) {
  const now = new Date();
  const tz = serverEnv.timezone();
  const [last, hourly, daily] = await Promise.all([
    getLatestTick(db),
    getCandles(db, "1 hour", new Date(now.getTime() - 30 * 86400_000)),
    getCandles(db, "1 day", new Date(now.getTime() - 400 * 86400_000)),
  ]);
  if (!last) return null;
  const today = startOfDayInTz(now, tz).getTime();
  const prevDays = daily.filter((d) => new Date(d.bucket).getTime() < today);
  const prevDayClose = prevDays.at(-1)?.close ?? hourly.find((h) => new Date(h.bucket).getTime() >= now.getTime() - 86400_000)?.open ?? null;
  const weekAgo = now.getTime() - 7 * 86400_000;
  const weekAgoClose =
    [...daily].reverse().find((d) => new Date(d.bucket).getTime() <= weekAgo)?.close ??
    hourly.find((h) => new Date(h.bucket).getTime() >= weekAgo)?.open ??
    null;
  const ind = computeIndicators(last.spot, hourly as CloseCandle[], daily as CloseCandle[], { prevDayClose, weekAgoClose });
  return { indicators: ind, signal: readSignal(ind), lastTick: last, hourlyCount: hourly.length, dailyCount: daily.length };
}
