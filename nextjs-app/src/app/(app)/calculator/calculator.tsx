"use client";

import { useMemo, useState } from "react";
import { KARATS, valueOf } from "@/lib/gold/calc";
import { fmt } from "@/lib/format";
import type { PriceSnapshot } from "@/lib/server/snapshot";
import type { Karat } from "@/lib/types";
import { useLivePrice } from "@/components/use-price";

export function Calculator({ initial }: { initial: PriceSnapshot }) {
  const { snap } = useLivePrice(initial, 30_000);
  const [grams, setGrams] = useState("10");
  const [karat, setKarat] = useState<Karat>(21);
  const g = Number(grams.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(",", "."));

  const v = useMemo(() => {
    if (!("quote" in snap) || !snap.quote || !(g > 0)) return null;
    return valueOf(g, karat, snap.quote, snap.settings);
  }, [snap, g, karat]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">حاسبة الذهب</h1>
      <section className="card flex flex-col gap-4 p-5">
        <div>
          <label className="label" htmlFor="w">الوزن (غرام)</label>
          <input id="w" className="input num text-2xl" inputMode="decimal" value={grams} onChange={(e) => setGrams(e.target.value)} />
          <div className="mt-2 flex flex-wrap gap-2">
            {[1, 5, 10, 20, 50, 100].map((n) => (
              <button key={n} className="chip !min-h-9 num" onClick={() => setGrams(String(n))}>{n} غ</button>
            ))}
          </div>
        </div>
        <div>
          <span className="label">العيار</span>
          <div className="grid grid-cols-4 gap-2">
            {KARATS.map((k) => (
              <button key={k} className="chip justify-center !min-h-12 text-base font-semibold" data-on={karat === k} onClick={() => setKarat(k)}>{k}</button>
            ))}
          </div>
        </div>
      </section>

      {v ? (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Result label="قيمة البيع (ما تحصل عليه)" value={v.sell} hint="على سعر البيع Bid" accent />
          <Result label="قيمة الشراء (خام)" value={v.buy} hint="على سعر الشراء Ask بدون مصنعية" />
          <Result label="سعر المحل التقديري" value={v.shop} hint="شراء + مصنعية + هامش" />
          <p className="text-xs text-muted sm:col-span-3">
            يحتوي على <span className="num">{fmt(v.pureGrams, 3)}</span> غرام ذهب خالص. الأسعار استرشادية وقد تختلف عن أسعار المحلات.
          </p>
        </section>
      ) : (
        <p className="text-muted">أدخل وزناً صحيحاً.</p>
      )}
    </div>
  );
}

function Result({ label, value, hint, accent }: { label: string; value: number; hint: string; accent?: boolean }) {
  return (
    <div className={`card p-4 ${accent ? "border-gold/50" : ""}`}>
      <div className="text-sm text-muted">{label}</div>
      <div className={`num mt-1 text-2xl font-bold ${accent ? "gold-text" : ""}`}>{fmt(value)} <span className="text-sm font-normal text-muted">ر.س</span></div>
      <div className="mt-1 text-xs text-muted">{hint}</div>
    </div>
  );
}
