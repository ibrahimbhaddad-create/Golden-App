"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type ActionState = { ok?: boolean; error?: string };

const AlertInput = z
  .object({
    type: z.enum(["ounce_price", "gram_price", "pct_change"]),
    direction: z.enum(["above", "below"]),
    threshold: z.coerce.number().positive("القيمة يجب أن تكون أكبر من صفر"),
    karat: z.coerce.number().optional(),
    price_side: z.enum(["bid", "ask", "spot"]).default("spot"),
    change_window: z.enum(["1h", "24h", "day_open"]).optional(),
    mode: z.enum(["once", "recurring"]),
    cooldown_minutes: z.coerce.number().int().min(1).max(10080).default(60),
    channels: z.array(z.enum(["push", "telegram"])).min(1, "اختر قناة إشعار واحدة على الأقل"),
    note: z.string().trim().max(200).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === "gram_price" && ![24, 22, 21, 18].includes(v.karat ?? 0)) ctx.addIssue({ code: "custom", message: "اختر العيار" });
    if (v.type === "pct_change" && !v.change_window) ctx.addIssue({ code: "custom", message: "اختر الفترة" });
    if (v.type === "pct_change" && v.threshold >= 100) ctx.addIssue({ code: "custom", message: "النسبة يجب أن تكون أقل من 100%" });
  });

export async function createAlert(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = AlertInput.safeParse({
    type: form.get("type"),
    direction: form.get("direction"),
    threshold: form.get("threshold"),
    karat: form.get("karat") || undefined,
    price_side: form.get("price_side") || "spot",
    change_window: form.get("change_window") || undefined,
    mode: form.get("mode"),
    cooldown_minutes: form.get("cooldown_minutes") || 60,
    channels: form.getAll("channels"),
    note: form.get("note") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  const v = parsed.data;
  const row = {
    type: v.type,
    direction: v.direction,
    threshold: v.threshold,
    karat: v.type === "gram_price" ? v.karat : null,
    price_side: v.type === "gram_price" ? v.price_side : "spot",
    change_window: v.type === "pct_change" ? v.change_window : null,
    mode: v.mode,
    cooldown_minutes: v.cooldown_minutes,
    channels: v.channels,
    note: v.note || null,
  };
  const supabase = await createClient();
  const { count } = await supabase.from("alerts").select("id", { count: "exact", head: true });
  if ((count ?? 0) >= 50) return { error: "وصلت للحد الأقصى (50 تنبيه)" };
  const { error } = await supabase.from("alerts").insert(row);
  if (error) return { error: "تعذّر الحفظ: " + error.message };
  revalidatePath("/alerts");
  return { ok: true };
}

export async function toggleAlert(id: string, active: boolean) {
  await requireUser();
  const supabase = await createClient();
  // Re-arming a one-shot alert clears its last trigger so it can fire again.
  await supabase.from("alerts").update(active ? { active, last_triggered_at: null } : { active }).eq("id", id);
  revalidatePath("/alerts");
}

export async function deleteAlert(id: string) {
  await requireUser();
  const supabase = await createClient();
  await supabase.from("alerts").delete().eq("id", id);
  revalidatePath("/alerts");
}
