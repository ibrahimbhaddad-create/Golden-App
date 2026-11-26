import { NextResponse } from "next/server";
import { apiUser } from "@/lib/server/api-auth";
import { sendPushToUsers } from "@/lib/server/push";

export async function POST() {
  const auth = await apiUser();
  if ("error" in auth) return auth.error;
  const r = await sendPushToUsers([auth.session.user.id], {
    title: "✅ الإشعارات تعمل",
    body: "ستصلك تنبيهات الذهب على هذا الجهاز حتى لو كان التطبيق مغلقاً.",
    url: "/settings",
    tag: "test",
  });
  return NextResponse.json(r);
}
