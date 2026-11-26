"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { redeemInvite } from "@/lib/server/invites";

export type InviteState = { error?: string };

export async function acceptInvite(_prev: InviteState, form: FormData): Promise<InviteState> {
  const token = String(form.get("token") ?? "");
  const parsed = z.string().trim().toLowerCase().email().safeParse(form.get("email"));
  if (!parsed.success) return { error: "صيغة البريد غير صحيحة" };
  const email = parsed.data;

  const res = await redeemInvite(token, email);
  if (!res.ok) return { error: res.reason };

  const supabase = await createClient();
  await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  redirect(`/login?email=${encodeURIComponent(email)}&sent=1`);
}
