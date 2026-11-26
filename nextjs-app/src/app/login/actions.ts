"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/supabase/admin";
import { ensureAdminAccount, isAdminEmail, normalizeEmail, recordFailedSignIn, recordSignIn } from "@/lib/auth";

export type LoginState = { step: "email" | "code"; email?: string; error?: string; info?: string };

const emailSchema = z.string().trim().toLowerCase().email();

export async function sendCode(_prev: LoginState, form: FormData): Promise<LoginState> {
  const parsed = emailSchema.safeParse(form.get("email"));
  if (!parsed.success) return { step: "email", error: "صيغة البريد غير صحيحة" };
  const email = parsed.data;

  try {
    if (isAdminEmail(email)) {
      await ensureAdminAccount(email);
    } else {
      const { data: profile } = await adminClient()
        .from("profiles")
        .select("status")
        .ilike("email", email)
        .maybeSingle();
      if (!profile) {
        return { step: "email", email, error: "لا يوجد حساب بهذا البريد. التسجيل بدعوة من المشرف فقط." };
      }
      if (profile.status === "suspended") {
        return { step: "email", email, error: "تم إيقاف هذا الحساب. تواصل مع المشرف." };
      }
    }
  } catch (e) {
    console.error("sendCode lookup failed", e);
    return { step: "email", email, error: "تعذّر الاتصال بالخادم، حاول مرة أخرى." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  if (error) {
    const rate = /rate|seconds|too many/i.test(error.message);
    return {
      step: "email",
      email,
      error: rate ? "طلبت رموزاً كثيرة. انتظر دقيقة ثم حاول." : "تعذّر إرسال الرمز: " + error.message,
    };
  }
  return { step: "code", email, info: "أرسلنا رمز الدخول إلى بريدك." };
}

export async function verifyCode(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = normalizeEmail(String(form.get("email") ?? ""));
  const token = String(form.get("code") ?? "").replace(/\D/g, "");
  if (token.length < 6) return { step: "code", email, error: "أدخل الرمز المكوّن من 6 أرقام أو أكثر" };

  const h = await headers();
  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error || !data.user) {
    await recordFailedSignIn(email, h, error?.message ?? "no user").catch(() => {});
    return { step: "code", email, error: "الرمز غير صحيح أو منتهي الصلاحية" };
  }
  await recordSignIn(data.user, h);
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
