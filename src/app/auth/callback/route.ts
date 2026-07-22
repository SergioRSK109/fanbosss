import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const redirectTo = request.nextUrl.searchParams.get("redirect") ?? "/dashboard";

  if (!code) {
    return NextResponse.redirect(
      new URL("/login?error=missing_code", request.url),
    );
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    // Most common real-world cause: the PKCE code_verifier cookie set at
    // signUp() time wasn't present on this request -- e.g. the
    // confirmation link was opened in a different browser/device than the
    // one that signed up, or a mail client pre-fetched/"scanned" the link
    // before the user clicked it, consuming the one-time code. Redirecting
    // to /dashboard here regardless would leave whatever session cookie
    // (if any) already in the browser unchanged, silently showing that
    // stale account instead of surfacing the failure.
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error.message)}`, request.url),
    );
  }

  return NextResponse.redirect(new URL(redirectTo, request.url));
}
