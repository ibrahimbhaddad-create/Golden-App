import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getPriceSnapshot } from "@/lib/server/snapshot";
import { Calculator } from "./calculator";

export const metadata: Metadata = { title: "الحاسبة" };
export const dynamic = "force-dynamic";

export default async function CalculatorPage() {
  const snap = await getPriceSnapshot(await createClient());
  return <Calculator initial={snap} />;
}
