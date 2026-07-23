import { redirect, Link } from "@/i18n/navigation";
import { ParametresForm } from "@/components/ParametresForm";
import { getSignedDownloadUrl } from "@/lib/r2";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function ParametresPage({
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

  const { data: profil } = await supabase
    .from("users")
    .select("pseudo, bio, lien_reseau_social, classement_public, photo_r2_key")
    .eq("id", user.id)
    .single();

  const photoUrl = profil?.photo_r2_key
    ? await getSignedDownloadUrl(profil.photo_r2_key, 60 * 60 * 24)
    : null;

  return (
    <main className="mx-auto max-w-sm p-6">
      <Link href="/dashboard" className="text-sm underline">
        ← Retour au tableau de bord
      </Link>
      <h1 className="text-2xl font-semibold mt-2 mb-6">Réglages du profil</h1>
      <ParametresForm
        pseudo={profil?.pseudo ?? null}
        bio={profil?.bio ?? null}
        lienReseauSocial={profil?.lien_reseau_social ?? null}
        classementPublic={profil?.classement_public ?? false}
        photoUrl={photoUrl}
      />
    </main>
  );
}
