import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { normalizeEmail } from "@/lib/auth";

export interface InviteRow {
  id: string;
  token: string;
  email: string | null;
  role: "admin" | "viewer";
  auto_approve: boolean;
  max_uses: number;
  uses: number;
  expires_at: string;
  revoked: boolean;
}

export type InviteCheck = { ok: true; invite: InviteRow } | { ok: false; reason: string };

export async function peekInvite(token: string): Promise<InviteCheck> {
  const { data } = await adminClient().from("invites").select("*").eq("token", token).maybeSingle<InviteRow>();
  if (!data) return { ok: false, reason: "رابط الدعوة غير صحيح" };
  if (data.revoked) return { ok: false, reason: "تم إلغاء هذه الدعوة" };
  if (new Date(data.expires_at) < new Date()) return { ok: false, reason: "انتهت صلاحية الدعوة" };
  if (data.uses >= data.max_uses) return { ok: false, reason: "تم استخدام الدعوة بالكامل" };
  return { ok: true, invite: data };
}

/**
 * Consume an invite and create the auth user. Atomic on the invite row; if
 * creating the user fails, the use is given back.
 */
export async function redeemInvite(token: string, rawEmail: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const email = normalizeEmail(rawEmail);
  const db = adminClient();

  const { data: existing } = await db.from("profiles").select("id").ilike("email", email).maybeSingle();
  if (existing) return { ok: false, reason: "هذا البريد مسجّل مسبقاً، سجّل الدخول مباشرة." };

  const { data: consumed, error } = await db.rpc("consume_invite", { p_token: token, p_email: email });
  const invite = (consumed as InviteRow[] | null)?.[0];
  if (error || !invite) {
    const peek = await peekInvite(token);
    if (!peek.ok) return peek;
    if (peek.invite.email && normalizeEmail(peek.invite.email) !== email) {
      return { ok: false, reason: "هذه الدعوة مخصّصة لبريد آخر" };
    }
    return { ok: false, reason: "تعذّر استخدام الدعوة" };
  }

  const { error: createErr } = await db.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: {
      app_role: invite.role,
      app_status: invite.auto_approve ? "active" : "pending",
      invite_id: invite.id,
    },
  });
  if (createErr) {
    await db.from("invites").update({ uses: Math.max(0, invite.uses - 1) }).eq("id", invite.id);
    return { ok: false, reason: "تعذّر إنشاء الحساب: " + createErr.message };
  }
  return { ok: true };
}
