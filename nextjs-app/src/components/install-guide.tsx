"use client";

import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

export function InstallGuide() {
  const [standalone, setStandalone] = useState(false);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    setStandalone(window.matchMedia("(display-mode: standalone)").matches || !!(navigator as unknown as { standalone?: boolean }).standalone);
    const h = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", h);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);

  if (standalone) return null;
  return (
    <section className="card flex flex-col gap-3 p-5">
      <h2 className="font-semibold">تثبيت التطبيق</h2>
      {deferred && <button className="btn btn-gold" onClick={() => deferred.prompt()}>تثبيت على الجهاز</button>}
      <div className="text-sm leading-7 text-muted">
        <p className="font-medium text-text">الآيفون (Safari):</p>
        <ol className="list-decimal pr-5">
          <li>اضغط زر المشاركة <span aria-hidden>⬆️</span> أسفل الشاشة</li>
          <li>اختر «إضافة إلى الشاشة الرئيسية»</li>
          <li>افتح التطبيق من الأيقونة ثم فعّل الإشعارات من هنا</li>
        </ol>
        <p className="mt-2 font-medium text-text">أندرويد (Chrome):</p>
        <p>القائمة ⋮ ← «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».</p>
      </div>
    </section>
  );
}
