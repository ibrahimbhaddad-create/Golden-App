import { NextResponse } from "next/server";
import { z } from "zod";
import { adminClient } from "@/lib/supabase/admin";
import { apiUser } from "@/lib/server/api-auth";

const Sub = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
});

export async function POST(req: Request) {
  const auth = await apiUser();
  if ("error" in auth) return auth.error;
  const parsed = Sub.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid subscription" }, { status: 400 });
  const { endpoint, keys } = parsed.data;
  // An endpoint belongs to one device; re-bind it to whoever is signed in now.
  const { error } = await adminClient()
    .from("push_subscriptions")
    .upsert(
      {
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        user_id: auth.session.user.id,
        user_agent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
      },
      { onConflict: "endpoint" },
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const auth = await apiUser();
  if ("error" in auth) return auth.error;
  const body = (await req.json().catch(() => ({}))) as { endpoint?: string };
  if (!body.endpoint) return NextResponse.json({ error: "endpoint required" }, { status: 400 });
  await adminClient().from("push_subscriptions").delete().eq("endpoint", body.endpoint).eq("user_id", auth.session.user.id);
  return NextResponse.json({ ok: true });
}
