import "server-only";
import { sendNotification, setVapidDetails } from "web-push";
import { adminClient } from "@/lib/supabase/admin";
import { publicEnv, serverEnv } from "@/lib/env";

let configured = false;
export function pushConfigured(): boolean {
  if (!publicEnv.vapidPublicKey || !serverEnv.vapidPrivateKey()) return false;
  if (!configured) {
    setVapidDetails(serverEnv.vapidSubject(), publicEnv.vapidPublicKey, serverEnv.vapidPrivateKey());
    configured = true;
  }
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

interface SubRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Send to all of the given users' devices. Removes dead subscriptions. */
export async function sendPushToUsers(userIds: string[] | "all", payload: PushPayload) {
  const result = { sent: 0, failed: 0, removed: 0 };
  if (!pushConfigured()) return { ...result, skipped: "vapid-not-configured" as const };
  const db = adminClient();
  let q = db.from("push_subscriptions").select("id,user_id,endpoint,p256dh,auth");
  if (userIds !== "all") {
    if (userIds.length === 0) return result;
    q = q.in("user_id", userIds);
  }
  const { data: subs } = await q;
  const dead: string[] = [];
  const used: string[] = [];
  const body = JSON.stringify(payload);
  await Promise.all(
    ((subs ?? []) as SubRow[]).map(async (s) => {
      try {
        await sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
          TTL: 3600,
          urgency: "high",
          topic: payload.tag?.slice(0, 32).replace(/[^A-Za-z0-9_-]/g, ""),
        });
        result.sent++;
        used.push(s.id);
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) dead.push(s.id);
        result.failed++;
      }
    }),
  );
  if (dead.length) {
    await db.from("push_subscriptions").delete().in("id", dead);
    result.removed = dead.length;
  }
  if (used.length) {
    await db.from("push_subscriptions").update({ last_used_at: new Date().toISOString() }).in("id", used);
  }
  return result;
}
