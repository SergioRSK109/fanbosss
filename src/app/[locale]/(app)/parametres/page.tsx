import { getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { LogoutButton } from "@/components/LogoutButton";
import { ParametresForm } from "@/components/ParametresForm";
import { VerificationForm } from "@/components/VerificationForm";
import { getSignedDownloadUrl } from "@/lib/r2";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { pseudoLockedUntil } from "@/lib/validation";
import type { PlateformeVerification } from "@/lib/verification";

export default async function ParametresPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Parametres" });
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect({ href: "/login", locale });
    return;
  }

  const [{ data: profil }, { data: demandeRows }] = await Promise.all([
    supabase
      .from("users")
      .select(
        "nom_affichage, pseudo, pseudo_modifie_at, bio, lien_tiktok, lien_instagram, lien_youtube, lien_autre, classement_public, masque_exploration, badge_fidelite_public, createur_verifie, photo_r2_key",
      )
      .eq("id", user.id)
      .single(),
    // Self-only (demandes_verification_select_own RLS) -- the most
    // recent request only, since only its state matters for what this
    // page shows (see VerificationForm's three states).
    supabase
      .from("demandes_verification")
      .select("plateforme, lien_compte, code_verification, statut")
      .eq("createur_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const photoUrl = profil?.photo_r2_key
    ? await getSignedDownloadUrl(profil.photo_r2_key, 60 * 60 * 24)
    : null;

  const derniereDemandeRow = demandeRows?.[0];
  const demandeActuelle =
    derniereDemandeRow &&
    (derniereDemandeRow.statut === "en_attente" || derniereDemandeRow.statut === "conflit")
      ? {
          plateforme: derniereDemandeRow.plateforme as PlateformeVerification,
          lienCompte: derniereDemandeRow.lien_compte,
          codeVerification: derniereDemandeRow.code_verification,
          statut: derniereDemandeRow.statut as "en_attente" | "conflit",
        }
      : null;

  return (
    <main className="mx-auto max-w-sm p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("heading")}</h1>
        <LogoutButton />
      </div>
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
        badgeFidelitePublic={profil?.badge_fidelite_public ?? false}
        photoUrl={photoUrl}
      />
      <div className="mt-4">
        <VerificationForm
          nomAffichage={profil?.nom_affichage ?? null}
          createurVerifie={profil?.createur_verifie ?? false}
          demandeActuelle={demandeActuelle}
        />
      </div>
    </main>
  );
}
