import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { getSession } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "تسجيل الدخول" };

const ERRORS: Record<string, string> = {
  suspended: "تم إيقاف حسابك. تواصل مع المشرف.",
  link: "رابط الدخول غير صالح أو منتهي. اطلب رمزاً جديداً.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const session = await getSession();
  if (session && session.profile.status === "active") redirect("/");

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 px-5 py-10 safe-top">
      <div className="flex flex-col items-center gap-3 text-center">
        <Brand size="lg" />
        <p className="text-muted">أسعار الذهب لحظياً بالريال السعودي</p>
      </div>
      <div className="card p-6">
        <LoginForm
          initialEmail={sp.email ?? ""}
          codeSent={sp.sent === "1"}
          error={sp.error ? ERRORS[sp.error] : undefined}
        />
      </div>
      <p className="text-center text-xs text-muted">التسجيل بدعوة من المشرف فقط</p>
    </main>
  );
}
