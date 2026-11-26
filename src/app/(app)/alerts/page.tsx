import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { describeAlert } from "@/lib/alerts/evaluate";
import { fmt, fmtDateTime } from "@/lib/format";
import { telegramConfigured } from "@/lib/server/telegram";
import type { Alert, AlertEvent } from "@/lib/types";
import { AlertForm } from "./alert-form";
import { AlertRowActions } from "./row-actions";

export const metadata: Metadata = { title: "التنبيهات" };
export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const { user, profile } = await requireUser();
  const supabase = await createClient();
  const [{ data: alerts }, { data: events }] = await Promise.all([
    supabase.from("alerts").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
    supabase.from("alert_events").select("*").eq("user_id", user.id).order("fired_at", { ascending: false }).limit(30),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-xl font-bold">التنبيهات</h1>
      <AlertForm telegramAvailable={telegramConfigured()} telegramLinked={!!profile.telegram_chat_id} />

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">تنبيهاتي ({alerts?.length ?? 0})</h2>
        {(alerts as Alert[] | null)?.length ? (
          (alerts as Alert[]).map((a) => (
            <div key={a.id} className={`card flex items-center justify-between gap-3 p-4 ${a.active ? "" : "opacity-60"}`}>
              <div className="min-w-0">
                <div className="font-semibold">{describeAlert({ ...a, threshold: Number(a.threshold) })}</div>
                <div className="mt-1 text-xs text-muted">
                  {a.mode === "once" ? "مرة واحدة" : `متكرر · تهدئة ${a.cooldown_minutes} د`} · {a.channels.map((c) => (c === "push" ? "إشعار" : "تيليجرام")).join(" + ")}
                  {a.trigger_count > 0 && <> · انطلق {a.trigger_count} مرة</>}
                  {!a.active && a.mode === "once" && a.trigger_count > 0 && " · منتهٍ"}
                </div>
                {a.note && <div className="mt-1 truncate text-xs text-muted">{a.note}</div>}
              </div>
              <AlertRowActions id={a.id} active={a.active} />
            </div>
          ))
        ) : (
          <p className="card p-4 text-sm text-muted">لا توجد تنبيهات. أضف أول تنبيه من الأعلى.</p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">سجل التنبيهات</h2>
        {(events as AlertEvent[] | null)?.length ? (
          <ul className="card divide-y divide-line">
            {(events as AlertEvent[]).map((e) => (
              <li key={e.id} className="p-4">
                <div className="font-medium">{e.title}</div>
                <div className="mt-0.5 text-sm text-muted">{e.body}</div>
                <div className="mt-1 text-xs text-muted">
                  <span className="num">{fmtDateTime(e.fired_at)}</span>
                  {e.observed_value != null && <> · القيمة <span className="num">{fmt(Number(e.observed_value))}</span></>}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="card p-4 text-sm text-muted">لم ينطلق أي تنبيه بعد.</p>
        )}
      </section>
    </div>
  );
}
