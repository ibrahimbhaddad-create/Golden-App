// Central place for environment variables. Server-only values are read lazily
// so that importing this file in the browser never touches secrets.

function req(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  vapidPublicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "",
  siteUrl: (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, ""),
};

export const serverEnv = {
  serviceRoleKey: () =>
    req("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY),
  adminEmail: () => (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase(),
  cronSecret: () => process.env.CRON_SECRET ?? "",
  goldApiKey: () => process.env.GOLDAPI_KEY ?? "",
  apiNinjasKey: () => process.env.API_NINJAS_KEY ?? "",
  vapidPrivateKey: () => process.env.VAPID_PRIVATE_KEY ?? "",
  vapidSubject: () => process.env.VAPID_SUBJECT ?? "mailto:admin@example.com",
  telegramToken: () => process.env.TELEGRAM_BOT_TOKEN ?? "",
  telegramBotUsername: () => (process.env.TELEGRAM_BOT_USERNAME ?? "").replace(/^@/, ""),
  telegramWebhookSecret: () => process.env.TELEGRAM_WEBHOOK_SECRET ?? "",
  anthropicKey: () => process.env.ANTHROPIC_API_KEY ?? "",
  anthropicModel: () => process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5",
  timezone: () => process.env.APP_TIMEZONE ?? "Asia/Riyadh",
};

export function siteUrlFrom(headers: Headers): string {
  if (publicEnv.siteUrl) return publicEnv.siteUrl;
  const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? "localhost:3000";
  const proto = headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
