import "server-only";
import { serverEnv } from "@/lib/env";

export const telegramConfigured = () => !!serverEnv.telegramToken();

export async function sendTelegram(chatId: string, text: string): Promise<boolean> {
  const token = serverEnv.telegramToken();
  if (!token || !chatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
