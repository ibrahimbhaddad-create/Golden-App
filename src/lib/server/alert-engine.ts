import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluateAlert, type Snapshot } from "@/lib/alerts/evaluate";
import { sendPushToUsers } from "@/lib/server/push";
import { sendTelegram } from "@/lib/server/telegram";
import type { Alert } from "@/lib/types";

/** Evaluate every active alert of every active user against a snapshot. */
export async function runAlerts(db: SupabaseClient, snap: Snapshot) {
  const { data: rows, error } = await db
    .from("alerts")
    .select("*, profiles!inner(status, telegram_chat_id)")
    .eq("active", true)
    .eq("profiles.status", "active");
  if (error) throw new Error("load alerts: " + error.message);

  const fired: { id: string; title: string }[] = [];
  for (const row of rows ?? []) {
    const { profiles: profile, ...rest } = row as Alert & { profiles: { telegram_chat_id: string | null } };
    const alert: Alert = { ...rest, threshold: Number(rest.threshold) };
    const ev = evaluateAlert(alert, snap);
    if (!ev.fire) continue;

    // Optimistic lock: only one concurrent run may claim this firing.
    let claim = db
      .from("alerts")
      .update({
        last_triggered_at: snap.now.toISOString(),
        trigger_count: alert.trigger_count + 1,
        active: alert.mode === "recurring",
      })
      .eq("id", alert.id)
      .eq("active", true);
    claim = alert.last_triggered_at ? claim.eq("last_triggered_at", alert.last_triggered_at) : claim.is("last_triggered_at", null);
    const { data: claimed } = await claim.select("id");
    if (!claimed?.length) continue;

    const delivery: Record<string, unknown> = {};
    if (alert.channels.includes("push")) {
      delivery.push = await sendPushToUsers([alert.user_id], {
        title: ev.title,
        body: ev.body,
        url: "/alerts",
        tag: `alert-${alert.id}`,
      });
    }
    if (alert.channels.includes("telegram")) {
      delivery.telegram = profile?.telegram_chat_id
        ? await sendTelegram(profile.telegram_chat_id, `${ev.title}\n${ev.body}`)
        : "not-linked";
    }
    await db.from("alert_events").insert({
      alert_id: alert.id,
      user_id: alert.user_id,
      title: ev.title,
      body: ev.body,
      observed_value: ev.value,
      delivery,
    });
    fired.push({ id: alert.id, title: ev.title });
  }
  return { checked: rows?.length ?? 0, fired };
}
