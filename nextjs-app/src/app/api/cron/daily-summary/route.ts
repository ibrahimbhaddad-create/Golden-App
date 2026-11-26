import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/server/cron-auth";
import { adminClient } from "@/lib/supabase/admin";
import { getMarketReading } from "@/lib/server/market";
import { getSettings } from "@/lib/server/prices";
import { writeDailySummary } from "@/lib/server/summary";
import { serverEnv } from "@/lib/env";
import { localDateString } from "@/lib/time";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = adminClient();
  const settings = await getSettings(db);
  if (!settings.ai_summary_enabled) return NextResponse.json({ ok: true, skipped: "disabled in settings" });
  const reading = await getMarketReading(db);
  if (!reading) return NextResponse.json({ ok: false, error: "no price data" }, { status: 409 });
  try {
    const out = await writeDailySummary(reading.indicators, reading.signal, settings.usd_sar);
    if (!out) return NextResponse.json({ ok: true, skipped: "no ANTHROPIC_API_KEY or refused" });
    const day = localDateString(new Date(), serverEnv.timezone());
    await db.from("market_summaries").upsert({ day, content: out.text, model: out.model, indicators: reading.indicators });
    return NextResponse.json({ ok: true, day });
  } catch (e) {
    console.error("daily summary failed", e);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
