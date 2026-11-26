"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";

export async function updateDisplayName(form: FormData) {
  await requireUser();
  const name = String(form.get("display_name") ?? "").trim().slice(0, 60);
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  await supabase.from("profiles").update({ display_name: name || null }).eq("id", data.user!.id);
  revalidatePath("/settings");
}

/** Create a one-time code and send the user to the bot. */
export async function linkTelegram() {
  const { user } = await requireUser();
  const bot = serverEnv.telegramBotUsername();
  if (!bot) return;
  const code = randomBytes(18).toString("base64url");
  await adminClient().from("profiles").update({ telegram_link_code: code }).eq("id", user.id);
  redirect(`https://t.me/${bot}?start=${code}`);
}

export async function unlinkTelegram() {
  const { user } = await requireUser();
  await adminClient().from("profiles").update({ telegram_chat_id: null, telegram_link_code: null }).eq("id", user.id);
  revalidatePath("/settings");
}
