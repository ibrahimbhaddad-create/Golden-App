import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { serverEnv } from "@/lib/env";
import type { IndicatorSet, Signal } from "@/lib/indicators";

const SYSTEM = `أنت محلل فني يكتب ملخصاً يومياً قصيراً بالعربية الفصحى المبسطة عن سوق الذهب لمستخدمين في السعودية.
- اكتب فقرة واحدة من 3 إلى 5 جمل فقط، بدون عناوين أو قوائم أو رموز تعبيرية.
- اعتمد فقط على الأرقام المعطاة، ولا تخترع أخباراً أو أحداثاً أو توقعات بأرقام غير موجودة.
- اذكر الاتجاه، ومستوى RSI، وأقرب دعم ومقاومة، والقراءة الآلية.
- لا تقدّم نصيحة استثمارية مباشرة، واستخدم لغة احتمالية.`;

/** Short Arabic market paragraph from Claude. Returns null if not configured. */
export async function writeDailySummary(ind: IndicatorSet, signal: Signal, usdSar: number): Promise<{ text: string; model: string } | null> {
  if (!serverEnv.anthropicKey()) return null;
  const client = new Anthropic({ apiKey: serverEnv.anthropicKey() });
  const data = {
    price_usd_oz: ind.price,
    usd_sar: usdSar,
    timeframe: ind.timeframe === "1d" ? "يومي" : "ساعة",
    ma20: ind.ma20,
    ma50: ind.ma50,
    ma200: ind.ma200,
    rsi14: ind.rsi14,
    change_day_pct: ind.changeDayPct,
    change_week_pct: ind.changeWeekPct,
    support_30d: ind.support,
    resistance_30d: ind.resistance,
    automated_signal: signal.label,
    reasons: signal.reasons,
  };
  const response = await client.beta.messages.create({
    model: serverEnv.anthropicModel(),
    max_tokens: 2000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low" },
    system: SYSTEM,
    messages: [{ role: "user", content: `بيانات اليوم (JSON):\n${JSON.stringify(data)}\n\nاكتب الملخص.` }],
  });
  if (response.stop_reason === "refusal") return null;
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  return text ? { text, model: response.model } : null;
}
