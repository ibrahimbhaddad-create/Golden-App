import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { recordSignIn } from "@/lib/auth";

/**
 * Email link handler (magic link / invite). Supabase email templates point
 * here with ?token_hash=...&type=email|invite|magiclink.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = (searchParams.get("type") ?? "email") as EmailOtpType;
  const to = request.nextUrl.clone();
  to.search = "";

  if (tokenHash) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error && data.user) {
      await recordSignIn(data.user, request.headers);
      to.pathname = "/";
      return NextResponse.redirect(to);
    }
  }
  to.pathname = "/login";
  to.searchParams.set("error", "link");
  return NextResponse.redirect(to);
}
