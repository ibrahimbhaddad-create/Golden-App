import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const to = request.nextUrl.clone();
  to.pathname = "/login";
  to.search = "";
  const reason = request.nextUrl.searchParams.get("reason");
  if (reason) to.searchParams.set("error", reason);
  return NextResponse.redirect(to);
}
