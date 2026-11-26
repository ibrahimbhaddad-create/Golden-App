import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { adminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { sendTelegram } from "@/lib/server/telegram";

/**
 * Telegram bot webhook. A user taps "ربط تيليجرام" in settings, which opens
 * t.me/<bot>?start=<code>; the bot receives "/start <code>" here and we store
 * the chat id on the matching profile.
 */
export async function POST(req: Request) {
  const secret = serverEnv.telegramWebhookSecret();
  const got = Buffer.from(req.headers.get("x-telegram-bot-api-secret-token") ?? "");
  const want = Buffer.from(secret);
  if (!secret || got.length !== want.length || !timingSafeEqual(got, want)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const update = (await req.json().catch(() => null)) as {
    message?: { chat?: { id?: number }; text?: string };
  } | null;
  const chatId = update?.message?.chat?.id;
  const text = update?.message?.text ?? "";
  if (!chatId) return NextResponse.json({ ok: true });

  const m = text.match(/^\/start\s+([A-Za-z0-9_-]{16,64})/);
  if (!m) {
    await sendTelegram(String(chatId), "مرحباً 👋 لربط حسابك افتح الإعدادات في تطبيق الذهب واضغط «ربط تيليجرام».");
    return NextResponse.json({ ok: true });
  }
  const db = adminClient();
  const { data: profile } = await db.from("profiles").select("id").eq("telegram_link_code", m[1]).maybeSingle();
  if (!profile) {
    await sendTelegram(String(chatId), "رمز الربط غير صالح أو مستخدم. أعد المحاولة من التطبيق.");
    return NextResponse.json({ ok: true });
  }
  await db.from("profiles").update({ telegram_chat_id: String(chatId), telegram_link_code: null }).eq("id", profile.id);
  await sendTelegram(String(chatId), "✅ تم ربط حسابك. ستصلك تنبيهات الذهب هنا.");
  return NextResponse.json({ ok: true });
}
