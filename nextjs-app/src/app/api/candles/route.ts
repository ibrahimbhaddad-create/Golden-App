import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { apiUser } from "@/lib/server/api-auth";
import { getCandles } from "@/lib/server/market";

export const dynamic = "force-dynamic";

const RANGES: Record<string, { bucket: string; days: number }> = {
  "1d": { bucket: "5 minutes", days: 1 },
  "7d": { bucket: "1 hour", days: 7 },
  "30d": { bucket: "4 hours", days: 30 },
  "90d": { bucket: "1 day", days: 90 },
  "1y": { bucket: "1 day", days: 365 },
};

export async function GET(req: NextRequest) {
  const auth = await apiUser();
  if ("error" in auth) return auth.error;
  const range = RANGES[req.nextUrl.searchParams.get("range") ?? "1d"] ?? RANGES["1d"];
  const candles = await getCandles(await createClient(), range.bucket, new Date(Date.now() - range.days * 86400_000));
  return NextResponse.json({ candles }, { headers: { "Cache-Control": "private, max-age=30" } });
}
