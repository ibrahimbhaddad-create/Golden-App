import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/server/cron-auth";
import { runTick } from "@/lib/server/tick";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const result = await runTick();
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch (e) {
    console.error("cron tick failed", e);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
