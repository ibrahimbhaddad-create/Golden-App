"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createAlert, type ActionState } from "./actions";

type T = "ounce_price" | "gram_price" | "pct_change";

export function AlertForm({ telegramAvailable, telegramLinked }: { telegramAvailable: boolean; telegramLinked: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createAlert, {});
  const [type, setType] = useState<T>("ounce_price");
  const [mode, setMode] = useState<"once" | "recurring">("once");
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      setOpen(false);
    }
  }, [state]);

  if (!open) {
    return (
      <button className="btn btn-gold w-full" onClick={() => setOpen(true)}>
        + تنبيه جديد
      </button>
    );
  }

  return (
    <form ref={formRef} action={action} className="card flex flex-col gap-4 p-5">
      <div>
        <span className="label">نوع التنبيه</span>
        <div className="grid grid-cols-3 gap-2">
          {([
            ["ounce_price", "سعر الأونصة"],
            ["gram_price", "سعر الغرام"],
            ["pct_change", "نسبة التغيّر"],
          ] as [T, string][]).map(([v, l]) => (
            <label key={v}>
              <input type="radio" name="type" value={v} checked={type === v} onChange={() => setType(v)} className="peer sr-only" />
              <span className="chip w-full justify-center text-sm">{l}</span>
            </label>
          ))}
        </div>
      </div>

      {type === "gram_price" && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="karat">العيار</label>
            <select id="karat" name="karat" className="input" defaultValue="21">
              {[24, 22, 21, 18].map((k) => <option key={k} value={k}>عيار {k}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="side">السعر</label>
            <select id="side" name="price_side" className="input" defaultValue="ask">
              <option value="ask">شراء</option>
              <option value="bid">بيع</option>
              <option value="spot">فوري</option>
            </select>
          </div>
        </div>
      )}

      {type === "pct_change" && (
        <div>
          <label className="label" htmlFor="win">خلال</label>
          <select id="win" name="change_window" className="input" defaultValue="24h">
            <option value="1h">ساعة</option>
            <option value="24h">24 ساعة</option>
            <option value="day_open">منذ افتتاح اليوم</option>
          </select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="dir">الشرط</label>
          <select id="dir" name="direction" className="input" defaultValue="above">
            {type === "pct_change" ? (
              <>
                <option value="above">صعود بنسبة</option>
                <option value="below">هبوط بنسبة</option>
              </>
            ) : (
              <>
                <option value="above">أعلى من</option>
                <option value="below">أقل من</option>
              </>
            )}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="th">{type === "ounce_price" ? "القيمة ($)" : type === "gram_price" ? "القيمة (ر.س/غ)" : "النسبة (%)"}</label>
          <input id="th" name="threshold" className="input num" inputMode="decimal" required placeholder={type === "pct_change" ? "1.5" : ""} />
        </div>
      </div>

      <div>
        <span className="label">التكرار</span>
        <div className="grid grid-cols-2 gap-2">
          <label>
            <input type="radio" name="mode" value="once" checked={mode === "once"} onChange={() => setMode("once")} className="peer sr-only" />
            <span className="chip w-full justify-center">مرة واحدة</span>
          </label>
          <label>
            <input type="radio" name="mode" value="recurring" checked={mode === "recurring"} onChange={() => setMode("recurring")} className="peer sr-only" />
            <span className="chip w-full justify-center">متكرر</span>
          </label>
        </div>
        {mode === "recurring" && (
          <div className="mt-3">
            <label className="label" htmlFor="cd">فترة التهدئة بين الإشعارات</label>
            <select id="cd" name="cooldown_minutes" className="input" defaultValue="60">
              <option value="15">15 دقيقة</option>
              <option value="30">30 دقيقة</option>
              <option value="60">ساعة</option>
              <option value="180">3 ساعات</option>
              <option value="720">12 ساعة</option>
              <option value="1440">يوم</option>
            </select>
          </div>
        )}
      </div>

      <div>
        <span className="label">قناة الإشعار</span>
        <div className="flex flex-wrap gap-2">
          <label>
            <input type="checkbox" name="channels" value="push" defaultChecked className="peer sr-only" />
            <span className="chip">إشعار التطبيق</span>
          </label>
          {telegramAvailable && (
            <label>
              <input type="checkbox" name="channels" value="telegram" disabled={!telegramLinked} className="peer sr-only" />
              <span className="chip">تيليجرام{!telegramLinked && " (اربطه من الإعدادات)"}</span>
            </label>
          )}
        </div>
      </div>

      <div>
        <label className="label" htmlFor="note">ملاحظة (اختياري)</label>
        <input id="note" name="note" className="input" maxLength={200} />
      </div>

      {state.error && <p className="text-sm text-red-300">{state.error}</p>}
      <div className="flex gap-2">
        <button className="btn btn-gold flex-1" disabled={pending}>{pending ? "جارٍ الحفظ…" : "حفظ التنبيه"}</button>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>إلغاء</button>
      </div>
    </form>
  );
}
