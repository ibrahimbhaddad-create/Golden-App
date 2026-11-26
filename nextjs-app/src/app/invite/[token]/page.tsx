import type { Metadata } from "next";
import { Brand } from "@/components/brand";
import { peekInvite } from "@/lib/server/invites";
import { InviteForm } from "./invite-form";

export const metadata: Metadata = { title: "دعوة" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const check = await peekInvite(token);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 px-5 py-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <Brand size="lg" />
        <p className="text-muted">تمت دعوتك لاستخدام تطبيق مراقبة الذهب</p>
      </div>
      <div className="card p-6">
        {check.ok ? (
          <InviteForm token={token} lockedEmail={check.invite.email} />
        ) : (
          <div className="flex flex-col gap-4 text-center">
            <p className="text-red-300">{check.reason}</p>
            <a href="/login" className="btn btn-ghost">لدي حساب — تسجيل الدخول</a>
          </div>
        )}
      </div>
    </main>
  );
}
