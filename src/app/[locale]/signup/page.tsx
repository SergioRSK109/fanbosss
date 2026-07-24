import { Suspense } from "react";
import { redirect } from "@/i18n/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SignupForm } from "./SignupForm";

// Same reasoning as login/page.tsx: an already-authenticated visitor
// should never land on the signup form either.
export default async function SignupPage({
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
      <SignupForm />
    </Suspense>
  );
}
