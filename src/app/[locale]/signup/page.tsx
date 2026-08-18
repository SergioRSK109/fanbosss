import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { AuthPageHeader } from "@/components/AuthPageHeader";
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
    redirect({ href: "/home", locale });
    return;
  }

  const tHome = await getTranslations({ locale, namespace: "Home" });

  return (
    <div className="flex min-h-dvh flex-col">
      <AuthPageHeader locale={locale} linkHref="/login" linkText={tHome("login")} />
      <div className="flex flex-1 items-center justify-center">
        <Suspense>
          <SignupForm />
        </Suspense>
      </div>
    </div>
  );
}
