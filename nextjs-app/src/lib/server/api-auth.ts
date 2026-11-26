import "server-only";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

/** For route handlers: active user or a JSON error response. */
export async function apiUser(opts: { admin?: boolean } = {}) {
  const s = await getSession();
  if (!s) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) } as const;
  if (s.profile.status !== "active") return { error: NextResponse.json({ error: "inactive" }, { status: 403 }) } as const;
  if (opts.admin && s.profile.role !== "admin") return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) } as const;
  return { session: s } as const;
}
