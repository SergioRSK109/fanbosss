import { Suspense } from "react";
import { redirect } from "@/i18n/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { LoginForm } from "./LoginForm";

// Bug found via a real logged-in trace (empirical, not assumed -- see
// CLAUDE.md "Logo-click 'logout' bug"): the session cookie itself is
// never touched by navigating around the site. The confusing "I got
// logged out" experience came from this page rendering the login form
// unconditionally, even for an already-authenticated visitor -- so
// clicking through from a page that doesn't reflect auth state (Home)
// landed them right back on a real password prompt. Redirecting an
// already-authenticated visitor straight to /dashboard closes that.
export default async function LoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect({ href: "/dashboard", locale });
    return;
  }

  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
