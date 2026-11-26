import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getMarketReading } from "@/lib/server/market";
import { getSettings } from "@/lib/server/prices";
import { ounceToGramSar } from "@/lib/gold/calc";
import { fmt, fmtPct } from "@/lib/format";
import { serverEnv } from "@/lib/env";
import { localDateString } from "@/lib/time";

export const metadata: Metadata = { title: "قراءة السوق" };
export const dynamic = "force-dynamic";

const TONE = {
  buy: "border-up/50 bg-up/10 text-up",
  sell: "border-down/50 bg-down/10 text-down",
  neutral: "border-gold/40 bg-gold/10 text-gold-soft",
};

export default async function MarketPage() {
  const supabase = await createClient();
  const [reading, settings, { data: summaries }] = await Promise.all([
    getMarketReading(supabase),
    getSettings(supabase),
    supabase.from("market_summaries").select("day,content,created_at").order("day", { ascending: false }).limit(1),
  ]);
  const summary = summaries?.[0];
  const isToday = summary?.day === localDateString(new Date(), serverEnv.timezone());

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">قراءة السوق</h1>

      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
        ⚠️ هذه قراءة فنية آلية وليست نصيحة استثمارية.
      </div>

      {!reading ? (
        <p className="card p-5 text-muted">لا توجد بيانات أسعار بعد.</p>
      ) : (
        <>
          <section className={`rounded-2xl border p-5 ${TONE[reading.signal.kind]}`}>
            <div className="text-sm opacity-80">الإشارة الحالية</div>
            <div className="mt-1 text-3xl font-bold">{reading.signal.label}</div>
            <ul className="mt-3 flex list-disc flex-col gap-1 pr-5 text-sm text-text/90">
              {reading.signal.reasons.map((r) => <li key={r}>{r}</li>)}
            </ul>
            <p className="mt-3 text-xs text-text/60">
              الإطار الزمني للمؤشرات: {reading.indicators.timeframe === "1d" ? "يومي" : "ساعة"} · عدد العينات <span className="num">{reading.indicators.samples}</span>
              {reading.indicators.timeframe === "1h" && " (يتحول لليومي تلقائياً بعد تجمّع 50 يوماً من البيانات)"}
            </p>
          </section>

          <section className="grid grid-cols-2 gap-3">
            <Metric label="السعر الحالي" value={`${fmt(reading.indicators.price)} $`} sub={`${fmt(ounceToGramSar(reading.indicators.price, 24, settings.usd_sar))} ر.س/غ عيار 24`} />
            <Metric label="RSI (14)" value={reading.indicators.rsi14 == null ? "—" : fmt(reading.indicators.rsi14, 1)} sub={rsiHint(reading.indicators.rsi14)} />
            <Metric label="التغير اليومي" value={fmtPct(reading.indicators.changeDayPct)} tone={reading.indicators.changeDayPct} />
            <Metric label="التغير الأسبوعي" value={fmtPct(reading.indicators.changeWeekPct)} tone={reading.indicators.changeWeekPct} />
            <Metric label="متوسط 20" value={fmtMa(reading.indicators.ma20)} sub={vsPrice(reading.indicators.price, reading.indicators.ma20)} />
            <Metric label="متوسط 50" value={fmtMa(reading.indicators.ma50)} sub={vsPrice(reading.indicators.price, reading.indicators.ma50)} />
            <Metric label="متوسط 200" value={fmtMa(reading.indicators.ma200)} sub={vsPrice(reading.indicators.price, reading.indicators.ma200)} />
            <Metric label="آخر 30 يوماً" value={`${fmtMa(reading.indicators.support)} / ${fmtMa(reading.indicators.resistance)}`} sub="دعم / مقاومة" />
          </section>
        </>
      )}

      {summary && (
        <section className="card p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">الملخص اليومي</h2>
            <span className="num text-xs text-muted">{summary.day}{!isToday && " (سابق)"}</span>
          </div>
          <p className="mt-2 leading-8 text-text/90">{summary.content}</p>
          <p className="mt-2 text-xs text-muted">مكتوب آلياً بالذكاء الاصطناعي (Claude) من المؤشرات أعلاه.</p>
        </section>
      )}
    </div>
  );
}

const fmtMa = (v: number | null) => (v == null ? "—" : fmt(v));
const vsPrice = (p: number, ma: number | null) => (ma == null ? "بيانات غير كافية" : p >= ma ? "السعر فوقه" : "السعر تحته");
const rsiHint = (r: number | null) => (r == null ? "بيانات غير كافية" : r < 30 ? "تشبّع بيعي" : r > 70 ? "تشبّع شرائي" : "محايد");

function Metric({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: number | null }) {
  const color = tone == null ? "" : tone >= 0 ? "text-up" : "text-down";
  return (
    <div className="card p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className={`num mt-1 text-lg font-bold ${color}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}
