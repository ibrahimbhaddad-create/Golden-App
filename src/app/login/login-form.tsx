"use client";

import { useActionState } from "react";
import { sendCode, verifyCode, type LoginState } from "./actions";

export function LoginForm({ initialEmail, codeSent, error }: { initialEmail: string; codeSent: boolean; error?: string }) {
  const [emailState, sendAction, sending] = useActionState<LoginState, FormData>(sendCode, {
    step: codeSent ? "code" : "email",
    email: initialEmail,
    error,
    info: codeSent ? "أرسلنا رمز الدخول إلى بريدك." : undefined,
  });
  const [codeState, verifyAction, verifying] = useActionState<LoginState, FormData>(verifyCode, { step: "code" });

  const step = emailState.step;
  const email = emailState.email ?? initialEmail;

  if (step === "email") {
    return (
      <form action={sendAction} className="flex flex-col gap-4">
        <div>
          <label className="label" htmlFor="email">البريد الإلكتروني</label>
          <input id="email" name="email" type="email" inputMode="email" autoComplete="email" required dir="ltr" defaultValue={email} className="input text-left" placeholder="you@example.com" />
        </div>
        {emailState.error && <p className="text-sm text-red-300">{emailState.error}</p>}
        <button className="btn btn-gold w-full" disabled={sending}>{sending ? "جارٍ الإرسال…" : "أرسل رمز الدخول"}</button>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <form action={verifyAction} className="flex flex-col gap-4">
        <input type="hidden" name="email" value={email} />
        <p className="text-sm text-muted">
          {emailState.info} <span className="num text-text">{email}</span>
        </p>
        <div>
          <label className="label" htmlFor="code">رمز التحقق</label>
          <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={10} required autoFocus className="input num text-center text-2xl tracking-[0.4em]" placeholder="••••••" />
        </div>
        {(codeState.error || emailState.error) && <p className="text-sm text-red-300">{codeState.error ?? emailState.error}</p>}
        <button className="btn btn-gold w-full" disabled={verifying}>{verifying ? "جارٍ التحقق…" : "دخول"}</button>
      </form>
      <form action={sendAction}>
        <input type="hidden" name="email" value={email} />
        <button className="btn btn-ghost w-full" disabled={sending}>{sending ? "…" : "إعادة إرسال الرمز"}</button>
      </form>
      <a href="/login" className="text-center text-sm text-muted underline">تغيير البريد</a>
    </div>
  );
}
