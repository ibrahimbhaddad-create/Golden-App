"use client";

import { useEffect, useRef } from "react";

/** TradingView Advanced Chart widget for OANDA:XAUUSD. */
export function TradingViewChart({ height = 380 }: { height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    host.innerHTML = '<div class="tradingview-widget-container__widget" style="height:100%;width:100%"></div>';
    const s = document.createElement("script");
    s.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    s.async = true;
    s.type = "text/javascript";
    s.innerHTML = JSON.stringify({
      autosize: true,
      symbol: "OANDA:XAUUSD",
      interval: "60",
      timezone: "Asia/Riyadh",
      theme: "dark",
      style: "1",
      locale: "ar_AE",
      backgroundColor: "rgba(21,19,15,1)",
      gridColor: "rgba(46,41,32,0.6)",
      hide_side_toolbar: true,
      allow_symbol_change: false,
      save_image: false,
      calendar: false,
      support_host: "https://www.tradingview.com",
    });
    host.appendChild(s);
    return () => {
      host.innerHTML = "";
    };
  }, []);
  return <div ref={ref} className="tradingview-widget-container overflow-hidden rounded-xl" style={{ height }} dir="ltr" />;
}
