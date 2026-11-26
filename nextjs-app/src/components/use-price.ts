"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/client";
import type { PriceSnapshot } from "@/lib/server/snapshot";

/**
 * Live price: starts from the server snapshot, refreshes on Supabase Realtime
 * inserts into price_ticks, and polls as a fallback (only while visible).
 */
export function useLivePrice(initial: PriceSnapshot, pollMs = 20_000) {
  const [snap, setSnap] = useState(initial);
  const [online, setOnline] = useState(true);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const res = await fetch("/api/price", { cache: "no-store" });
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (res.ok) {
        setSnap(await res.json());
        setOnline(true);
      }
    } catch {
      setOnline(false);
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    const id = setInterval(() => document.visibilityState === "visible" && refresh(), pollMs);
    const onVis = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", refresh);

    let channel: ReturnType<ReturnType<typeof getBrowserClient>["channel"]> | null = null;
    try {
      const sb = getBrowserClient();
      channel = sb
        .channel("price_ticks")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "price_ticks" }, () => refresh())
        .subscribe();
    } catch {
      /* realtime optional */
    }
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", refresh);
      if (channel) getBrowserClient().removeChannel(channel);
    };
  }, [refresh, pollMs]);

  return { snap, online, refresh };
}
