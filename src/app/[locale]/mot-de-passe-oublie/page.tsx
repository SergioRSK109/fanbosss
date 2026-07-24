import { Suspense } from "react";
import { redirect } from "@/i18n/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { MotDePasseOublieForm } from "./MotDePasseOublieForm";

// An already-authenticated visitor doesn't need the email-reset flow --
// they can already set a new password directly from /parametres, using
// their active session (see ParametresForm's "Mot de passe" field).
// Redirecting there instead of showing this form follows the same
// already-authenticated pattern login/signup already use.
export default async function MotDePasseOubliePage({
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
    redirect({ href: "/parametres", locale });
    return;
  }

  return (
    <Suspense>
      <MotDePasseOublieForm />
    </Suspense>
  );
}
