"use client";
import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";

let client: ReturnType<typeof createBrowserClient> | null = null;

export function getBrowserClient() {
  if (!client) client = createBrowserClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey);
  return client;
}
