import { redirect, Link } from "@/i18n/navigation";
import { LogoutButton } from "@/components/LogoutButton";
import { ParametresForm } from "@/components/ParametresForm";
import { getSignedDownloadUrl } from "@/lib/r2";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { pseudoLockedUntil } from "@/lib/validation";

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
    .select(
      "nom_affichage, pseudo, pseudo_modifie_at, bio, lien_tiktok, lien_instagram, lien_youtube, lien_autre, classement_public, masque_exploration, photo_r2_key",
    )
    .eq("id", user.id)
    .single();

  const photoUrl = profil?.photo_r2_key
    ? await getSignedDownloadUrl(profil.photo_r2_key, 60 * 60 * 24)
    : null;

  return (
    <main className="mx-auto max-w-sm p-6">
      <div className="flex items-center justify-between">
        <Link
          href="/dashboard"
          className="text-sm font-medium text-foreground-muted hover:text-foreground"
        >
          ← Retour au tableau de bord
        </Link>
        <LogoutButton />
      </div>
      <h1 className="mb-6 mt-2 text-2xl font-bold">Réglages du profil</h1>
      <ParametresForm
        nomAffichage={profil?.nom_affichage ?? null}
        pseudo={profil?.pseudo ?? null}
        pseudoLockedUntil={pseudoLockedUntil(profil?.pseudo_modifie_at ?? null)}
        bio={profil?.bio ?? null}
        lienTiktok={profil?.lien_tiktok ?? null}
        lienInstagram={profil?.lien_instagram ?? null}
        lienYoutube={profil?.lien_youtube ?? null}
        lienAutre={profil?.lien_autre ?? null}
        classementPublic={profil?.classement_public ?? false}
        masqueExploration={profil?.masque_exploration ?? false}
        photoUrl={photoUrl}
      />
    </main>
  );
}
