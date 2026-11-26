import { createClient } from "@/lib/supabase/server";
import { getPriceSnapshot } from "@/lib/server/snapshot";
import { LiveDashboard } from "@/components/live-dashboard";
import { ChartTabs } from "@/components/chart-tabs";

export const dynamic = "force-dynamic";

export default async function Home() {
  const snap = await getPriceSnapshot(await createClient());
  return (
    <div className="flex flex-col gap-4">
      <LiveDashboard initial={snap} />
      <ChartTabs />
    </div>
  );
}
