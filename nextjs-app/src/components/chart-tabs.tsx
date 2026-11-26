"use client";

import { useState } from "react";
import { OwnChart } from "./own-chart";
import { TradingViewChart } from "./tradingview-chart";

export function ChartTabs() {
  const [tab, setTab] = useState<"own" | "tv">("own");
  return (
    <section className="card p-4">
      <div className="mb-3 flex gap-2">
        <button className="chip" data-on={tab === "own"} onClick={() => setTab("own")}>رسم بياناتنا</button>
        <button className="chip" data-on={tab === "tv"} onClick={() => setTab("tv")}>TradingView</button>
      </div>
      {tab === "own" ? <OwnChart /> : <TradingViewChart />}
    </section>
  );
}
