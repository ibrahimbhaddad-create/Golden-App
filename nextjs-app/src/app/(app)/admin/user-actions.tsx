"use client";

import { useState, useTransition } from "react";
import { deleteUser, revokeInvite, setUserRole, setUserStatus } from "./actions";

export function UserActions({ id, status, role }: { id: string; status: string; role: string }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const run = (fn: () => Promise<void>) =>
    start(async () => {
      try {
        setErr("");
        await fn();
      } catch (e) {
        setErr((e as Error).message);
      }
    });
  const small = "btn !min-h-10 !px-3 text-sm";
  return (
    <div className="flex flex-wrap gap-2">
      {status !== "active" && <button className={`${small} btn-gold`} disabled={pending} onClick={() => run(() => setUserStatus(id, "active"))}>{status === "pending" ? "موافقة" : "إعادة تفعيل"}</button>}
      {status === "active" && <button className={`${small} btn-ghost`} disabled={pending} onClick={() => run(() => setUserStatus(id, "suspended"))}>إيقاف</button>}
      <button className={`${small} btn-ghost`} disabled={pending} onClick={() => run(() => setUserRole(id, role === "admin" ? "viewer" : "admin"))}>
        {role === "admin" ? "جعله مشاهداً" : "جعله مشرفاً"}
      </button>
      <button className={`${small} btn-danger`} disabled={pending} onClick={() => confirm("حذف المستخدم وكل تنبيهاته نهائياً؟") && run(() => deleteUser(id))}>حذف</button>
      {err && <span className="text-xs text-red-300">{err}</span>}
    </div>
  );
}

export function InviteRevoke({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button className="text-xs text-red-300 underline" disabled={pending} onClick={() => start(() => revokeInvite(id))}>إلغاء</button>
  );
}
