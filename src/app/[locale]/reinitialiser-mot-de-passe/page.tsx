import { Suspense } from "react";
import { redirect } from "@/i18n/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ReinitialiserMotDePasseForm } from "./ReinitialiserMotDePasseForm";

// Protected the same way every other authenticated page in this app is:
// by the time a visitor lands here for real, /auth/callback has already
// exchanged the emailed code for a session (see
// mot-de-passe-oublie/MotDePasseOublieForm.tsx). Someone hitting this URL
// directly without a valid/unexpired session gets sent to /login, same as
// /dashboard or /parametres would.
export default async function ReinitialiserMotDePassePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect({ href: "/login", locale });
    return;
  }

  return (
    <Suspense>
      <ReinitialiserMotDePasseForm />
    </Suspense>
  );
}
