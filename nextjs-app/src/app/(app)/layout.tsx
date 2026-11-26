import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { Brand } from "@/components/brand";
import { BottomNav } from "@/components/bottom-nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireUser();
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-ink/85 backdrop-blur safe-top">
        <div className="flex h-14 items-center justify-between px-4">
          <Link href="/"><Brand /></Link>
          {profile.role === "admin" && (
            <Link href="/admin" className="chip text-sm text-gold-soft">لوحة الأدمن</Link>
          )}
        </div>
      </header>
      <main className="flex-1 px-4 pb-28 pt-4">{children}</main>
      <BottomNav />
    </div>
  );
}
