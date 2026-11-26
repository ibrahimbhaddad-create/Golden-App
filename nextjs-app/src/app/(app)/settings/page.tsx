import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { serverEnv } from "@/lib/env";
import { signOut } from "@/app/login/actions";
import { PushManager } from "@/components/push-manager";
import { InstallGuide } from "@/components/install-guide";
import { linkTelegram, unlinkTelegram, updateDisplayName } from "./actions";

export const metadata: Metadata = { title: "الإعدادات" };

export default async function SettingsPage() {
  const { profile } = await requireUser();
  const tgBot = serverEnv.telegramBotUsername();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">الإعدادات</h1>

      <section className="card flex flex-col gap-3 p-5">
        <h2 className="font-semibold">الحساب</h2>
        <p className="text-sm text-muted">
          <span className="num">{profile.email}</span> · {profile.role === "admin" ? "مشرف" : "مشاهد"}
        </p>
        <form action={updateDisplayName} className="flex gap-2">
          <input name="display_name" className="input" placeholder="الاسم" defaultValue={profile.display_name ?? ""} maxLength={60} />
          <button className="btn btn-ghost">حفظ</button>
        </form>
      </section>

      <section className="card flex flex-col gap-3 p-5">
        <h2 className="font-semibold">الإشعارات</h2>
        <PushManager />
      </section>

      {tgBot && (
        <section className="card flex flex-col gap-3 p-5">
          <h2 className="font-semibold">تيليجرام</h2>
          {profile.telegram_chat_id ? (
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-up">✓ مربوط بحسابك</span>
              <form action={unlinkTelegram}><button className="btn btn-ghost">فك الربط</button></form>
            </div>
          ) : (
            <form action={linkTelegram}>
              <p className="mb-3 text-sm text-muted">اربط حسابك ببوت تيليجرام لتصلك التنبيهات هناك أيضاً.</p>
              <button className="btn btn-gold w-full">ربط تيليجرام</button>
            </form>
          )}
        </section>
      )}

      <InstallGuide />

      {profile.role === "admin" && <Link href="/admin" className="btn btn-ghost">لوحة الأدمن</Link>}
      <form action={signOut}><button className="btn btn-danger w-full">تسجيل الخروج</button></form>
    </div>
  );
}
