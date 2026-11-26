import type { Metadata } from "next";
import { requireAdmin, isAdminEmail } from "@/lib/auth";
import { adminClient } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/server/prices";
import { fmtDateTime } from "@/lib/format";
import { headers } from "next/headers";
import { siteUrlFrom } from "@/lib/env";
import type { Profile } from "@/lib/types";
import { BroadcastForm, InviteForm, SettingsForm } from "./forms";
import { InviteRevoke, UserActions } from "./user-actions";

export const metadata: Metadata = { title: "لوحة الأدمن" };
export const dynamic = "force-dynamic";

const STATUS = { active: "فعّال", pending: "بانتظار الموافقة", suspended: "موقوف" } as const;
const STATUS_TONE = { active: "text-up", pending: "text-amber-300", suspended: "text-down" } as const;
const SOURCE = { goldapi: "GoldAPI.io", apininjas: "API Ninjas", goldapicom: "gold-api.com" } as Record<string, string>;

export default async function AdminPage() {
  const { user } = await requireAdmin();
  const db = adminClient();
  const [{ data: users }, { data: invites }, { data: logins }, { data: health }, { data: alertCounts }, settings, { data: lastTick }] = await Promise.all([
    db.from("profiles").select("*").order("created_at", { ascending: false }),
    db.from("invites").select("*").eq("revoked", false).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(30),
    db.from("login_events").select("*").order("at", { ascending: false }).limit(40),
    db.from("source_health").select("*"),
    db.from("alerts").select("user_id").eq("active", true),
    getSettings(db),
    db.from("price_ticks").select("time,source").order("time", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const countBy = new Map<string, number>();
  for (const a of alertCounts ?? []) countBy.set(a.user_id, (countBy.get(a.user_id) ?? 0) + 1);
  const base = siteUrlFrom(await headers());
  const pending = (users as Profile[] | null)?.filter((u) => u.status === "pending").length ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-xl font-bold">لوحة الأدمن</h1>

      <section className="grid grid-cols-3 gap-3 text-center">
        <Kpi label="المستخدمون" value={users?.length ?? 0} />
        <Kpi label="بانتظار الموافقة" value={pending} warn={pending > 0} />
        <Kpi label="تنبيهات فعّالة" value={alertCounts?.length ?? 0} />
      </section>

      <Section title="المستخدمون">
        <ul className="divide-y divide-line">
          {(users as Profile[] | null)?.map((u) => (
            <li key={u.id} className="flex flex-col gap-2 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="num truncate font-medium">{u.email}</div>
                  <div className="text-xs text-muted">
                    {u.display_name && <>{u.display_name} · </>}
                    {u.role === "admin" ? "مشرف" : "مشاهد"} · <span className={STATUS_TONE[u.status]}>{STATUS[u.status]}</span> · تنبيهات {countBy.get(u.id) ?? 0}
                    {u.last_login_at && <> · آخر دخول <span className="num">{fmtDateTime(u.last_login_at)}</span></>}
                  </div>
                </div>
              </div>
              {u.id !== user.id && !isAdminEmail(u.email) && <UserActions id={u.id} status={u.status} role={u.role} />}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="دعوة مستخدم">
        <InviteForm />
        {!!invites?.length && (
          <div className="mt-4">
            <h3 className="mb-2 text-sm text-muted">دعوات سارية</h3>
            <ul className="flex flex-col gap-2">
              {invites.map((i) => (
                <li key={i.id} className="rounded-xl bg-panel-2 p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="num truncate">{i.email ?? "رابط مفتوح"}</span>
                    <InviteRevoke id={i.id} />
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    استُخدم <span className="num">{i.uses}/{i.max_uses}</span> · ينتهي <span className="num">{fmtDateTime(i.expires_at)}</span> · {i.auto_approve ? "تفعيل تلقائي" : "يحتاج موافقة"}
                    {i.note && <> · {i.note}</>}
                  </div>
                  <input readOnly className="input num mt-2 !min-h-10 text-xs" dir="ltr" value={`${base}/invite/${i.token}`} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section title="الأسعار والمصنعية">
        <SettingsForm settings={settings} />
      </Section>

      <Section title="إشعار لكل المستخدمين">
        <BroadcastForm />
      </Section>

      <Section title="حالة مصادر الأسعار">
        <p className="mb-2 text-xs text-muted">
          آخر سعر محفوظ: {lastTick ? <><span className="num">{fmtDateTime(lastTick.time)}</span> من {SOURCE[lastTick.source] ?? lastTick.source}</> : "لا يوجد"}
        </p>
        <ul className="flex flex-col gap-2 text-sm">
          {["goldapi", "apininjas", "goldapicom"].map((s) => {
            const h = health?.find((x) => x.source === s);
            const paused = h?.disabled_until && new Date(h.disabled_until) > new Date();
            return (
              <li key={s} className="rounded-xl bg-panel-2 p-3">
                <div className="flex justify-between">
                  <span className="font-medium">{SOURCE[s]}</span>
                  <span className={paused ? "text-amber-300" : h?.consecutive_failures ? "text-down" : h ? "text-up" : "text-muted"}>
                    {paused ? "متوقف مؤقتاً" : h?.consecutive_failures ? `فشل ×${h.consecutive_failures}` : h ? "يعمل" : "لم يُستخدم"}
                  </span>
                </div>
                {h?.last_success_at && <div className="text-xs text-muted">آخر نجاح <span className="num">{fmtDateTime(h.last_success_at)}</span></div>}
                {h?.last_error && h.consecutive_failures > 0 && <div className="num mt-1 truncate text-xs text-down/80">{h.last_error}</div>}
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="سجل الدخول">
        <ul className="divide-y divide-line text-sm">
          {logins?.map((l) => (
            <li key={l.id} className="py-2">
              <div className="flex justify-between gap-2">
                <span className="num truncate">{l.email}</span>
                <span className={l.success ? "text-up" : "text-down"}>{l.success ? "نجاح" : "فشل"}</span>
              </div>
              <div className="num truncate text-xs text-muted">{fmtDateTime(l.at)} · {l.ip ?? "—"} · {(l.user_agent ?? "").slice(0, 60)}</div>
            </li>
          ))}
          {!logins?.length && <li className="py-2 text-muted">لا يوجد</li>}
        </ul>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <h2 className="mb-3 font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Kpi({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="card p-3">
      <div className={`num text-2xl font-bold ${warn ? "text-amber-300" : "gold-text"}`}>{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}
