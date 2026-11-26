"use client";

import { useActionState } from "react";
import { acceptInvite, type InviteState } from "./actions";

export function InviteForm({ token, lockedEmail }: { token: string; lockedEmail: string | null }) {
  const [state, action, pending] = useActionState<InviteState, FormData>(acceptInvite, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <div>
        <label className="label" htmlFor="email">بريدك الإلكتروني</label>
        <input id="email" name="email" type="email" required dir="ltr" className="input text-left" defaultValue={lockedEmail ?? ""} readOnly={!!lockedEmail} placeholder="you@example.com" />
      </div>
      {state.error && <p className="text-sm text-red-300">{state.error}</p>}
      <button className="btn btn-gold w-full" disabled={pending}>{pending ? "جارٍ الإنشاء…" : "قبول الدعوة وإرسال رمز الدخول"}</button>
    </form>
  );
}
