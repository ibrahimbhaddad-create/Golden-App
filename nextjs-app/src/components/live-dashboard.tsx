"use client";

import { useEffect, useRef, useState } from "react";
import { fmt, fmtPct, fmtSigned, fmtTime } from "@/lib/format";
import type { PriceSnapshot } from "@/lib/server/snapshot";
import { useLivePrice } from "./use-price";

const SOURCE_LABEL: Record<string, string> = { goldapi: "GoldAPI", apininjas: "API Ninjas", goldapicom: "gold-api.com" };

export function LiveDashboard({ initial }: { initial: PriceSnapshot }) {
  const { snap, online } = useLivePrice(initial);
  const [flash, setFlash] = useState<"" | "flash-up" | "flash-down">("");
  const prev = useRef<number | null>(snap.tick?.spot ?? null);
  const [, force] = useState(0);

  useEffect(() => {
    const spot = snap.tick?.spot ?? null;
    if (spot != null && prev.current != null && spot !== prev.current) {
      setFlash(spot > prev.current ? "flash-up" : "flash-down");
      const t = setTimeout(() => setFlash(""), 1500);
      prev.current = spot;
      return () => clearTimeout(t);
    }
    prev.current = spot;
  }, [snap.tick?.spot, snap.tick?.id]);

  // re-render every 15s so the "live" badge ages correctly
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  if (!snap.tick || !("quote" in snap) || !snap.quote) {
    return (
      <section className="card p-6 text-center">
        <p className="text-lg font-semibold">لا توجد أسعار بعد</p>
        <p className="mt-1 text-sm text-muted">سيظهر السعر عند أول جلب ناجح من المصادر. تأكد من إعداد المهمة المجدولة.</p>
      </section>
    );
  }

  const { quote, karats, change, tick, settings } = snap;
  const ageSec = (Date.now() - new Date(tick.time).getTime()) / 1000;
  const live = online && ageSec < 180;
  const up = (change.dayPct ?? 0) >= 0;
  const k24 = karats.find((k) => k.karat === 24)!;

  return (
    <>
      <section className="card relative overflow-hidden p-5">
        <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-72 -translate-x-1/2 rounded-full bg-gold/10 blur-3xl" />
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted">الأونصة · دولار</span>
          <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${live ? "bg-up/10 text-up" : "bg-amber-500/10 text-amber-400"}`}>
            <span className={`h-2 w-2 rounded-full ${live ? "bg-up live-dot" : "bg-amber-400"}`} />
            {live ? "مباشر" : online ? "متأخر" : "غير متصل"}
          </span>
        </div>
        <div key={tick.id} className={`num mt-2 text-right text-5xl font-bold tracking-tight sm:text-6xl ${flash}`}>
          <span className={flash ? "" : "gold-text"}>{fmt(quote.spot)}</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className={`num font-semibold ${up ? "text-up" : "text-down"}`}>
            {up ? "▲" : "▼"} {fmtSigned(change.dayAbs)} ({fmtPct(change.dayPct)})
          </span>
          <span className="text-muted">منذ افتتاح اليوم</span>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <Stat label="شراء (Ask)" value={fmt(quote.ask)} />
          <Stat label="بيع (Bid)" value={fmt(quote.bid)} />
          <Stat label="غرام 24 ر.س" value={fmt(k24.spot)} gold />
        </div>
        <p className="mt-3 text-xs text-muted">
          آخر تحديث <span className="num">{fmtTime(tick.time)}</span> · المصدر {SOURCE_LABEL[tick.source] ?? tick.source}
          {quote.estimated && " · الشراء/البيع تقديري"} · الدولار = <span className="num">{fmt(settings.usd_sar, 2)}</span> ر.س
        </p>
      </section>

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between px-4 pt-4">
          <h2 className="font-semibold">أسعار العيارات · ريال/غرام</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="mt-2 w-full text-sm">
            <thead className="text-muted">
              <tr className="border-b border-line">
                <th className="px-3 py-2 text-right font-medium">العيار</th>
                <th className="px-2 py-2 font-medium">شراء</th>
                <th className="px-2 py-2 font-medium">بيع</th>
                <th className="px-2 py-2 font-medium">الفرق</th>
                <th className="px-3 py-2 font-medium">سعر المحل</th>
              </tr>
            </thead>
            <tbody>
              {karats.map((k) => (
                <tr key={k.karat} className="border-b border-line/60 last:border-0">
                  <td className="px-3 py-3 font-bold text-gold-soft">عيار {k.karat}</td>
                  <td className="num px-2 py-3 text-center">{fmt(k.buy)}</td>
                  <td className="num px-2 py-3 text-center">{fmt(k.sell)}</td>
                  <td className="num px-2 py-3 text-center text-muted">{fmt(k.spread)}</td>
                  <td className="num px-3 py-3 text-center font-semibold">{fmt(k.shop)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-4 pb-4 pt-2 text-xs text-muted">سعر المحل تقديري = سعر الشراء + المصنعية + هامش المحل (يحددها المشرف).</p>
      </section>
    </>
  );
}

function Stat({ label, value, gold }: { label: string; value: string; gold?: boolean }) {
  return (
    <div className="rounded-xl bg-panel-2 px-2 py-2.5">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={`num mt-0.5 font-semibold ${gold ? "text-gold-soft" : ""}`}>{value}</div>
    </div>
  );
}
