import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { apiUser } from "@/lib/server/api-auth";
import { getPriceSnapshot } from "@/lib/server/snapshot";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await apiUser();
  if ("error" in auth) return auth.error;
  const snap = await getPriceSnapshot(await createClient());
  return NextResponse.json(snap, { headers: { "Cache-Control": "private, no-store" } });
}
