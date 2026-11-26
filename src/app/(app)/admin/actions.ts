"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isAdminEmail, requireAdmin } from "@/lib/auth";
import { adminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { siteUrlFrom } from "@/lib/env";
import { sendPushToUsers } from "@/lib/server/push";
import { sendTelegram } from "@/lib/server/telegram";

export type AdminState = { ok?: boolean; error?: string; info?: string; link?: string };

const InviteInput = z.object({
  email: z.string().trim().toLowerCase().email().optional().or(z.literal("").transform(() => undefined)),
  role: z.enum(["viewer", "admin"]).default("viewer"),
  auto_approve: z.boolean(),
  max_uses: z.coerce.number().int().min(1).max(1000).default(1),
  days: z.coerce.number().int().min(1).max(90).default(7),
  note: z.string().trim().max(120).optional(),
});

export async function createInvite(_prev: AdminState, form: FormData): Promise<AdminState> {
  const { user } = await requireAdmin();
  const parsed = InviteInput.safeParse({
    email: form.get("email") ?? "",
    role: form.get("role") ?? "viewer",
    auto_approve: form.get("auto_approve") === "on",
    max_uses: form.get("max_uses") || 1,
    days: form.get("days") || 7,
    note: form.get("note") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  const v = parsed.data;
  const db = adminClient();

  if (v.email) {
    const { data: exists } = await db.from("profiles").select("id").ilike("email", v.email).maybeSingle();
    if (exists) return { error: "هذا البريد لديه حساب بالفعل" };
  }

  const { data: invite, error } = await db
    .from("invites")
    .insert({
      email: v.email ?? null,
      role: v.role,
      auto_approve: v.auto_approve,
      max_uses: v.email ? 1 : v.max_uses,
      expires_at: new Date(Date.now() + v.days * 86400_000).toISOString(),
      note: v.note ?? null,
      created_by: user.id,
    })
    .select("token")
    .single();
  if (error) return { error: error.message };

  const link = `${siteUrlFrom(await headers())}/invite/${invite.token}`;
  let info = "تم إنشاء رابط الدعوة. أرسله للمستخدم.";
  if (v.email) {
    // Send Supabase's invite email too (uses the "Invite user" template).
    const { error: mailErr } = await db.auth.admin.inviteUserByEmail(v.email, { redirectTo: link });
    if (mailErr) {
      info = "تم إنشاء الدعوة، لكن تعذّر إرسال البريد (" + mailErr.message + "). أرسل الرابط يدوياً.";
    } else {
      // inviteUserByEmail creates the auth user right away: apply the invite's role/status.
      const { data: created } = await db.from("profiles").select("id").ilike("email", v.email).maybeSingle();
      if (created) {
        await db.from("profiles").update({ role: v.role, status: v.auto_approve ? "active" : "pending" }).eq("id", created.id);
        await db.from("invites").update({ uses: 1 }).eq("token", invite.token);
        info = "تم إرسال الدعوة إلى البريد. يستطيع المستخدم الدخول برمز OTP مباشرة.";
      }
    }
  }
  revalidatePath("/admin");
  return { ok: true, info, link };
}

export async function revokeInvite(id: string) {
  await requireAdmin();
  await adminClient().from("invites").update({ revoked: true }).eq("id", id);
  revalidatePath("/admin");
}

async function guardTarget(targetId: string) {
  const { user } = await requireAdmin();
  if (targetId === user.id) throw new Error("لا يمكنك تعديل حسابك من هنا");
  const { data } = await adminClient().from("profiles").select("email").eq("id", targetId).maybeSingle();
  if (data && isAdminEmail(data.email)) throw new Error("لا يمكن تعديل حساب المشرف الرئيسي");
  return user;
}

export async function setUserStatus(id: string, status: "active" | "suspended" | "pending") {
  await guardTarget(id);
  const db = adminClient();
  // Suspended users lose access immediately: RLS checks status on every query
  // and requireUser() signs them out on their next page load.
  await db.from("profiles").update({ status }).eq("id", id);
  revalidatePath("/admin");
}

export async function setUserRole(id: string, role: "admin" | "viewer") {
  await guardTarget(id);
  await adminClient().from("profiles").update({ role }).eq("id", id);
  revalidatePath("/admin");
}

export async function deleteUser(id: string) {
  await guardTarget(id);
  await adminClient().auth.admin.deleteUser(id); // cascades to profile, alerts, …
  revalidatePath("/admin");
}

const SettingsInput = z.object({
  usd_sar: z.coerce.number().min(0.01).max(100),
  fallback_spread_usd: z.coerce.number().min(0).max(100),
  ai_summary_enabled: z.boolean(),
  karats: z.record(z.string(), z.object({ making: z.coerce.number().min(0).max(10000), margin_pct: z.coerce.number().min(0).max(100) })),
});

export async function updateSettings(_prev: AdminState, form: FormData): Promise<AdminState> {
  const { user } = await requireAdmin();
  const karats: Record<string, { making: unknown; margin_pct: unknown }> = {};
  for (const k of ["24", "22", "21", "18"]) {
    karats[k] = { making: form.get(`making_${k}`) || 0, margin_pct: form.get(`margin_${k}`) || 0 };
  }
  const parsed = SettingsInput.safeParse({
    usd_sar: form.get("usd_sar"),
    fallback_spread_usd: form.get("fallback_spread_usd"),
    ai_summary_enabled: form.get("ai_summary_enabled") === "on",
    karats,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "قيم غير صحيحة" };
  // Goes through RLS: only an admin may update settings.
  const supabase = await createClient();
  const { error } = await supabase
    .from("settings")
    .update({ ...parsed.data, updated_at: new Date().toISOString(), updated_by: user.id })
    .eq("id", 1);
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { ok: true, info: "تم حفظ الإعدادات" };
}

export async function broadcast(_prev: AdminState, form: FormData): Promise<AdminState> {
  const { user } = await requireAdmin();
  const title = String(form.get("title") ?? "").trim().slice(0, 80);
  const body = String(form.get("body") ?? "").trim().slice(0, 300);
  const alsoTelegram = form.get("telegram") === "on";
  if (!title || !body) return { error: "العنوان والنص مطلوبان" };
  const db = adminClient();
  const { data: active } = await db.from("profiles").select("id,telegram_chat_id").eq("status", "active");
  const ids = (active ?? []).map((p) => p.id as string);
  const push = await sendPushToUsers(ids, { title, body, url: "/", tag: "broadcast" });
  let tg = 0;
  if (alsoTelegram) {
    for (const p of active ?? []) if (p.telegram_chat_id && (await sendTelegram(p.telegram_chat_id, `📢 ${title}\n${body}`))) tg++;
  }
  await db.from("broadcasts").insert({ title, body, created_by: user.id, sent_count: push.sent + tg, failed_count: push.failed });
  revalidatePath("/admin");
  const skipped = "skipped" in push ? " (مفاتيح VAPID غير مضبوطة)" : "";
  return { ok: true, info: `أُرسل إلى ${push.sent} جهاز${alsoTelegram ? ` و${tg} على تيليجرام` : ""}${skipped}` };
}
