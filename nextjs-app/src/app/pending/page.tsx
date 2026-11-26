import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { getSession } from "@/lib/auth";
import { signOut } from "@/app/login/actions";

export default async function PendingPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.profile.status === "active") redirect("/");
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 px-5 text-center">
      <Brand size="lg" />
      <div className="card p-6">
        <p className="text-lg font-semibold">حسابك بانتظار موافقة المشرف ⏳</p>
        <p className="mt-2 text-muted">سنفعّل الوصول بمجرد الموافقة. يمكنك إغلاق التطبيق والعودة لاحقاً.</p>
      </div>
      <form action={signOut}><button className="btn btn-ghost">تسجيل الخروج</button></form>
    </main>
  );
}
