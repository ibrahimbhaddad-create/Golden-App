"use client";

import { useEffect, useRef, useState } from "react";
import { AreaSeries, ColorType, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import type { Candle } from "@/lib/types";

const RANGES = [
  { id: "1d", label: "يوم" },
  { id: "7d", label: "أسبوع" },
  { id: "30d", label: "شهر" },
  { id: "90d", label: "3 أشهر" },
  { id: "1y", label: "سنة" },
];

export function OwnChart() {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Area"> | null>(null);
  const [range, setRange] = useState("1d");
  const [state, setState] = useState<"loading" | "empty" | "ok" | "error">("loading");

  useEffect(() => {
    if (!el.current) return;
    const c = createChart(el.current, {
      height: 260,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#a39a86", fontFamily: "inherit" },
      grid: { vertLines: { color: "rgba(46,41,32,0.5)" }, horzLines: { color: "rgba(46,41,32,0.5)" } },
      rightPriceScale: { borderColor: "#2e2920" },
      timeScale: { borderColor: "#2e2920", timeVisible: true, secondsVisible: false },
      crosshair: { horzLine: { color: "#9c7a1c" }, vertLine: { color: "#9c7a1c" } },
      localization: { locale: "en-US" },
      autoSize: true,
    });
    series.current = c.addSeries(AreaSeries, {
      lineColor: "#d4af37",
      topColor: "rgba(212,175,55,0.35)",
      bottomColor: "rgba(212,175,55,0.02)",
      lineWidth: 2,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });
    chart.current = c;
    return () => {
      c.remove();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    fetch(`/api/candles?range=${range}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(({ candles }: { candles: Candle[] }) => {
        if (cancelled || !series.current) return;
        // Shift to local time for display (lightweight-charts renders UTC).
        const off = -new Date().getTimezoneOffset() * 60;
        series.current.setData(candles.map((c) => ({ time: (Math.floor(new Date(c.bucket).getTime() / 1000) + off) as UTCTimestamp, value: c.close })));
        chart.current?.timeScale().fitContent();
        setState(candles.length ? "ok" : "empty");
      })
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
  }, [range]);

  return (
    <div>
      <div className="mb-2 flex gap-1.5 overflow-x-auto">
        {RANGES.map((r) => (
          <button key={r.id} className="chip !min-h-9 text-xs" data-on={range === r.id} onClick={() => setRange(r.id)}>{r.label}</button>
        ))}
      </div>
      <div className="relative" dir="ltr">
        <div ref={el} className="h-[260px] w-full" />
        {state !== "ok" && (
          <div className="absolute inset-0 grid place-items-center text-sm text-muted" dir="rtl">
            {state === "loading" ? "جارٍ التحميل…" : state === "empty" ? "لا توجد بيانات كافية لهذه الفترة بعد" : "تعذّر تحميل الرسم"}
          </div>
        )}
      </div>
    </div>
  );
}
