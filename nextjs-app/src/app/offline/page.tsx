export const dynamic = "force-static";

export default function Offline() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-5 text-center">
      <img src="/icons/icon-192.png" alt="" width={72} height={72} className="rounded-2xl" />
      <p className="text-xl font-bold">لا يوجد اتصال بالإنترنت</p>
      <p className="text-muted">تحقّق من الاتصال ثم أعد المحاولة. ستستمر التنبيهات بالوصول عند عودة الشبكة.</p>
      <a href="/" className="btn btn-gold">إعادة المحاولة</a>
    </main>
  );
}
