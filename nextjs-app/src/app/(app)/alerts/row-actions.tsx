"use client";

import { useTransition } from "react";
import { deleteAlert, toggleAlert } from "./actions";

export function AlertRowActions({ id, active }: { id: string; active: boolean }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex shrink-0 gap-2">
      <button className="btn btn-ghost !min-h-10 !px-3 text-sm" disabled={pending} onClick={() => start(() => toggleAlert(id, !active))}>
        {active ? "إيقاف" : "تفعيل"}
      </button>
      <button
        className="btn btn-danger !min-h-10 !px-3 text-sm"
        disabled={pending}
        onClick={() => confirm("حذف التنبيه؟") && start(() => deleteAlert(id))}
        aria-label="حذف"
      >
        حذف
      </button>
    </div>
  );
}
