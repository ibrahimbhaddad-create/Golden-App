"use client";

import { useActionState, useState } from "react";
import type { Settings } from "@/lib/types";
import { broadcast, createInvite, updateSettings, type AdminState } from "./actions";

function Feedback({ s }: { s: AdminState }) {
  if (s.error) return <p className="text-sm text-red-300">{s.error}</p>;
  if (s.info) return <p className="text-sm text-up">{s.info}</p>;
  return null;
}

export function InviteForm() {
  const [state, action, pending] = useActionState<AdminState, FormData>(createInvite, {});
  const [kind, setKind] = useState<"link" | "email">("link");
  const [copied, setCopied] = useState(false);
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="chip justify-center" data-on={kind === "link"} onClick={() => setKind("link")}>رابط دعوة</button>
        <button type="button" className="chip justify-center" data-on={kind === "email"} onClick={() => setKind("email")}>دعوة بالإيميل</button>
      </div>
      {kind === "email" ? (
        <input name="email" type="email" required dir="ltr" className="input text-left" placeholder="friend@example.com" />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">عدد الاستخدامات</label>
            <input name="max_uses" type="number" min={1} max={1000} defaultValue={1} className="input num" />
          </div>
          <div>
            <label className="label">الصلاحية (أيام)</label>
            <input name="days" type="number" min={1} max={90} defaultValue={7} className="input num" />
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">الدور</label>
          <select name="role" className="input" defaultValue="viewer">
            <option value="viewer">مشاهد</option>
            <option value="admin">مشرف</option>
          </select>
        </div>
        <div>
          <label className="label">ملاحظة</label>
          <input name="note" className="input" maxLength={120} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="auto_approve" defaultChecked className="h-5 w-5 accent-[#d4af37]" />
        تفعيل الحساب تلقائياً (بدون انتظار موافقتي)
      </label>
      <Feedback s={state} />
      {state.link && (
        <div className="flex gap-2">
          <input readOnly className="input num text-xs" dir="ltr" value={state.link} />
          <button
            type="button"
            className="btn btn-ghost"
            onClick={async () => {
              if (navigator.share) await navigator.share({ title: "دعوة ذهب لايف", url: state.link }).catch(() => {});
              else {
                await navigator.clipboard.writeText(state.link!);
                setCopied(true);
              }
            }}
          >
            {copied ? "نُسخ ✓" : "مشاركة"}
          </button>
        </div>
      )}
      <button className="btn btn-gold" disabled={pending}>{pending ? "…" : "إنشاء الدعوة"}</button>
    </form>
  );
}

export function SettingsForm({ settings }: { settings: Settings }) {
  const [state, action, pending] = useActionState<AdminState, FormData>(updateSettings, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">سعر الدولار بالريال</label>
          <input name="usd_sar" className="input num" inputMode="decimal" defaultValue={settings.usd_sar} required />
        </div>
        <div>
          <label className="label">فرق شراء/بيع تقديري ($/أونصة)</label>
          <input name="fallback_spread_usd" className="input num" inputMode="decimal" defaultValue={settings.fallback_spread_usd} required />
        </div>
      </div>
      <p className="-mt-2 text-xs text-muted">يُستخدم الفرق التقديري فقط عندما لا يعطي المصدر سعري شراء وبيع.</p>
      <div className="overflow-hidden rounded-xl border border-line">
        <div className="grid grid-cols-3 bg-panel-2 px-3 py-2 text-xs text-muted">
          <span>العيار</span><span>المصنعية (ر.س/غ)</span><span>هامش المحل %</span>
        </div>
        {["24", "22", "21", "18"].map((k) => (
          <div key={k} className="grid grid-cols-3 items-center gap-2 border-t border-line px-3 py-2">
            <span className="font-semibold text-gold-soft">عيار {k}</span>
            <input name={`making_${k}`} className="input num !min-h-10" inputMode="decimal" defaultValue={settings.karats[k]?.making ?? 0} />
            <input name={`margin_${k}`} className="input num !min-h-10" inputMode="decimal" defaultValue={settings.karats[k]?.margin_pct ?? 0} />
          </div>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="ai_summary_enabled" defaultChecked={settings.ai_summary_enabled} className="h-5 w-5 accent-[#d4af37]" />
        الملخص اليومي بالذكاء الاصطناعي (يتطلب ANTHROPIC_API_KEY)
      </label>
      <Feedback s={state} />
      <button className="btn btn-gold" disabled={pending}>{pending ? "…" : "حفظ"}</button>
    </form>
  );
}

export function BroadcastForm() {
  const [state, action, pending] = useActionState<AdminState, FormData>(broadcast, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <input name="title" className="input" placeholder="العنوان" maxLength={80} required />
      <textarea name="body" className="input min-h-24 py-3" placeholder="نص الإشعار" maxLength={300} required />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="telegram" className="h-5 w-5 accent-[#d4af37]" /> إرسال على تيليجرام أيضاً
      </label>
      <Feedback s={state} />
      <button className="btn btn-gold" disabled={pending}>{pending ? "جارٍ الإرسال…" : "إرسال للجميع"}</button>
    </form>
  );
}
