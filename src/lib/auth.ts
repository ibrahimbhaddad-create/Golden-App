import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import type { Profile } from "@/lib/types";

export const normalizeEmail = (e: string) => e.trim().toLowerCase();

export function isAdminEmail(email: string | null | undefined): boolean {
  const admin = serverEnv.adminEmail();
  return !!admin && !!email && normalizeEmail(email) === admin;
}

/** Current user + profile (cached per request). */
export const getSession = cache(async (): Promise<{ user: User; profile: Profile } | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("id,email,display_name,role,status,telegram_chat_id,created_at,last_login_at")
    .eq("id", user.id)
    .maybeSingle<Profile>();
  if (!profile) return null;
  return { user, profile };
});

/** For pages/actions that need an active user. */
export async function requireUser() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.profile.status === "pending") redirect("/pending");
  if (s.profile.status === "suspended") redirect("/auth/signout?reason=suspended");
  return s;
}

export async function requireAdmin() {
  const s = await requireUser();
  if (s.profile.role !== "admin") redirect("/");
  return s;
}

/**
 * Make sure the ADMIN_EMAIL account exists and is an active admin.
 * Returns the user id. Uses the service role.
 */
export async function ensureAdminAccount(email: string): Promise<string> {
  const db = adminClient();
  const { data: existing } = await db.from("profiles").select("id,role,status").ilike("email", email).maybeSingle();
  if (existing) {
    if (existing.role !== "admin" || existing.status !== "active") {
      await db.from("profiles").update({ role: "admin", status: "active" }).eq("id", existing.id);
    }
    return existing.id;
  }
  const { data, error } = await db.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { app_role: "admin", app_status: "active" },
  });
  if (error || !data.user) throw new Error(error?.message ?? "createUser failed");
  // Trigger already created the profile from app_metadata; enforce anyway.
  await db.from("profiles").upsert({ id: data.user.id, email, role: "admin", status: "active" });
  return data.user.id;
}

/** Bookkeeping after a successful sign-in. */
export async function recordSignIn(user: User, headers: Headers) {
  const db = adminClient();
  const email = normalizeEmail(user.email ?? "");
  if (isAdminEmail(email)) await ensureAdminAccount(email);
  await Promise.all([
    db.from("profiles").update({ last_login_at: new Date().toISOString() }).eq("id", user.id),
    db.from("login_events").insert({
      user_id: user.id,
      email,
      ip: (headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null,
      user_agent: headers.get("user-agent")?.slice(0, 300) ?? null,
      success: true,
    }),
  ]);
}

export async function recordFailedSignIn(email: string, headers: Headers, detail: string) {
  await adminClient()
    .from("login_events")
    .insert({
      email: normalizeEmail(email),
      ip: (headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null,
      user_agent: headers.get("user-agent")?.slice(0, 300) ?? null,
      success: false,
      detail: detail.slice(0, 200),
    });
}
