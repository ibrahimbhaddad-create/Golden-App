"use client";

import { useEffect, useState } from "react";
import { publicEnv } from "@/lib/env";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

type Status = "loading" | "unsupported" | "ios-needs-install" | "denied" | "off" | "on";

export function PushManager() {
  const [status, setStatus] = useState<Status>("loading");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone;
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setStatus(ios && !standalone ? "ios-needs-install" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") return setStatus("denied");
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      setStatus(sub ? "on" : "off");
    })().catch(() => setStatus("unsupported"));
  }, []);

  async function enable() {
    setBusy(true);
    setMsg("");
    try {
      if (!publicEnv.vapidPublicKey) throw new Error("مفتاح VAPID غير مضبوط على الخادم");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setStatus(perm === "denied" ? "denied" : "off");
        return;
      }
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicEnv.vapidPublicKey) }));
      const res = await fetch("/api/push/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
      if (!res.ok) throw new Error("تعذّر حفظ الاشتراك");
      setStatus("on");
      setMsg("تم تفعيل الإشعارات على هذا الجهاز ✓");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        await sub.unsubscribe();
      }
      setStatus("off");
      setMsg("");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    const r = await fetch("/api/push/test", { method: "POST" }).then((r) => r.json()).catch(() => null);
    setMsg(r?.sent ? "أُرسل إشعار تجريبي" : r?.skipped ? "مفاتيح VAPID غير مضبوطة على الخادم" : "لم يُرسل الإشعار، أعد التفعيل");
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-3">
      {status === "loading" && <p className="text-sm text-muted">…</p>}
      {status === "unsupported" && <p className="text-sm text-muted">هذا المتصفح لا يدعم الإشعارات.</p>}
      {status === "ios-needs-install" && (
        <p className="text-sm text-amber-200">على الآيفون: ثبّت التطبيق أولاً على الشاشة الرئيسية (انظر الخطوات بالأسفل) ثم افتحه من الأيقونة لتفعيل الإشعارات.</p>
      )}
      {status === "denied" && <p className="text-sm text-red-300">الإشعارات محظورة. فعّلها من إعدادات المتصفح/الجهاز لهذا الموقع.</p>}
      {status === "off" && <button className="btn btn-gold" disabled={busy} onClick={enable}>تفعيل الإشعارات على هذا الجهاز</button>}
      {status === "on" && (
        <div className="flex gap-2">
          <button className="btn btn-ghost flex-1" disabled={busy} onClick={test}>إرسال إشعار تجريبي</button>
          <button className="btn btn-danger" disabled={busy} onClick={disable}>إيقاف</button>
        </div>
      )}
      {msg && <p className="text-sm text-muted">{msg}</p>}
    </div>
  );
}
