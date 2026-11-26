import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { publicEnv, serverEnv } from "@/lib/env";

let admin: SupabaseClient | null = null;

/** Service-role client: bypasses RLS. Server-side only, never expose. */
export function adminClient(): SupabaseClient {
  if (!admin) {
    admin = createClient(publicEnv.supabaseUrl, serverEnv.serviceRoleKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return admin;
}
