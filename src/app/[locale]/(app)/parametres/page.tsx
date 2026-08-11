import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { BadgesFideliteCard } from "@/components/BadgesFideliteCard";
import { ClassementProgresCard } from "@/components/ClassementProgresCard";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { LogoutButton } from "@/components/LogoutButton";
import { ParametresForm } from "@/components/ParametresForm";
import { ParrainageCard } from "@/components/ParrainageCard";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { RankBadge } from "@/components/ui/RankBadge";
import { VerificationForm } from "@/components/VerificationForm";
import { computePremieresTransactionsParPartenaire } from "@/lib/badgesFidelite";
import type { ProgresClassement } from "@/lib/classementProgres";
import { resolveDisplayName } from "@/lib/profil";
import { getSignedDownloadUrl } from "@/lib/r2";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseTheme, THEME_COOKIE_NAME } from "@/lib/theme";
import { pseudoLockedUntil } from "@/lib/validation";
import type { PlateformeVerification } from "@/lib/verification";

export default async function ParametresPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Parametres" });
  // Still reads from "Dashboard" for this section's own heading and the
  // rank-badge labels from "CreateurProfile" -- same "don't rename what
  // isn't user-visible" discipline this codebase already applied to the
  // Finance/finance split (Lot 2b) and /offres's own demandesHeading
  // (Lot 3): this is the exact same Performance content, moved verbatim,
  // not a new concern needing a new namespace.
  const tDashboard = await getTranslations({ locale, namespace: "Dashboard" });
  const tRanks = await getTranslations({ locale, namespace: "CreateurProfile" });
  const cookieStore = await cookies();
  const theme = parseTheme(cookieStore.get(THEME_COOKIE_NAME)?.value);
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect({ href: "/login", locale });
    return;
  }

  const [
    { data: profil },
    { data: demandeRows },
    { data: volumeRow },
    { data: reactiviteRow },
    { data: progressionRow },
    { data: progresRows },
    { data: transactionsLivrees },
    { data: parrainageRows },
  ] = await Promise.all([
    supabase
      .from("users")
      .select(
        "nom_affichage, pseudo, pseudo_modifie_at, bio, lien_tiktok, lien_instagram, lien_youtube, lien_autre, classement_public, masque_exploration, badge_fidelite_public, badge_donateur_public, createur_verifie, photo_r2_key, photo_couverture_r2_key",
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
    // Everything below this line, through mesBadges, is the former
    // /dashboard page's own Performance content -- moved here verbatim
    // (Lot 3 merge follow-up), not rebuilt.
    supabase.from("classement_volume").select("rang").eq("createur_id", user.id).maybeSingle(),
    supabase
      .from("classement_reactivite")
      .select("rang")
      .eq("createur_id", user.id)
      .maybeSingle(),
    supabase
      .from("classement_progression")
      .select("rang")
      .eq("createur_id", user.id)
      .maybeSingle(),
    supabase.rpc("mes_progres_classement"),
    // Private fan loyalty badge (migration 0022) -- own RLS-visible
    // transactions (transactions_select_fan: fan_id = auth.uid()), never
    // the badges_fidelite_publics view: that view is filtered by
    // badge_fidelite_public, which must never gate what a fan sees of
    // their own activity, opted in or not.
    supabase
      .from("transactions")
      .select("createur_id, created_at")
      .eq("fan_id", user.id)
      .eq("statut", "livree"),
    // Referral link section (migration 0050) -- self-only
    // (parrainages_select_own RLS: parrain_id = auth.uid()), no new RPC
    // needed. "Filleuls actifs" = distinct filleuls who've actually
    // generated a bonus (i.e. reached 'livree' on at least one
    // transaction within their own 30-day window), not merely every
    // signup that used this user's referral link -- someone who signed
    // up via the link but never transacted has no row here at all.
    supabase.from("parrainages").select("filleul_id, montant_bonus").eq("parrain_id", user.id),
  ]);

  const photoUrl = profil?.photo_r2_key
    ? await getSignedDownloadUrl(profil.photo_r2_key, 60 * 60 * 24)
    : null;
  const couvertureUrl = profil?.photo_couverture_r2_key
    ? await getSignedDownloadUrl(profil.photo_couverture_r2_key, 60 * 60 * 24)
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

  const progresRow = progresRows?.[0] as
    | {
        volume_actuel: number;
        volume_seuil_top10: number | null;
        volume_manque: number;
        reactivite_actuelle_secondes: number | null;
        reactivite_seuil_top10_secondes: number | null;
        reactivite_manque_secondes: number | null;
        progression_eligible: boolean;
        progression_actuel: number | null;
        progression_seuil_top10: number | null;
        progression_manque: number | null;
      }
    | undefined;

  const progres: ProgresClassement | null = progresRow
    ? {
        volumeActuel: progresRow.volume_actuel,
        volumeSeuilTop10: progresRow.volume_seuil_top10,
        volumeManque: progresRow.volume_manque,
        reactiviteActuelleSecondes: progresRow.reactivite_actuelle_secondes,
        reactiviteSeuilTop10Secondes: progresRow.reactivite_seuil_top10_secondes,
        reactiviteManqueSecondes: progresRow.reactivite_manque_secondes,
        progressionEligible: progresRow.progression_eligible,
        progressionActuel: progresRow.progression_actuel,
        progressionSeuilTop10: progresRow.progression_seuil_top10,
        progressionManque: progresRow.progression_manque,
      }
    : null;

  // Private loyalty badges: earliest delivered transaction per créateur
  // supported, computed live from the fan's own transactions (never
  // stored -- same principle as campagnes_montant_collecte elsewhere in
  // this app). Unconditional on badge_fidelite_public -- that flag only
  // controls whether OTHERS see this, never the fan's own private view of
  // it.
  const premieresParCreateur = computePremieresTransactionsParPartenaire(
    (transactionsLivrees ?? []).map((row) => ({
      partenaireId: row.createur_id,
      createdAt: row.created_at,
    })),
  );
  const createurIdsSupportes = Array.from(premieresParCreateur.keys());
  const { data: createursSupportes } =
    createurIdsSupportes.length > 0
      ? await supabase
          .from("profils_publics")
          .select("id, pseudo, nom_affichage")
          .in("id", createurIdsSupportes)
      : { data: [] as { id: string; pseudo: string | null; nom_affichage: string | null }[] };
  const createurProfilById = new Map((createursSupportes ?? []).map((p) => [p.id, p]));

  const filleulsActifs = new Set((parrainageRows ?? []).map((row) => row.filleul_id)).size;
  const totalGagneParrainage = (parrainageRows ?? []).reduce(
    (sum, row) => sum + Number(row.montant_bonus),
    0,
  );

  const mesBadges = createurIdsSupportes
    .map((createurId) => {
      const p = createurProfilById.get(createurId);
      return {
        createurId,
        displayName: resolveDisplayName(p?.nom_affichage ?? null, p?.pseudo ?? null),
        depuis: premieresParCreateur.get(createurId)!,
      };
    })
    .sort((a, b) => new Date(a.depuis).getTime() - new Date(b.depuis).getTime());

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("heading")}</h1>
        <LogoutButton />
      </div>
      {/* Nav reorg lot: LanguageSwitcher is hidden on the 5 AppTabBar
          routes (see TopNav.tsx) -- this is its dedicated home instead,
          same "consolidate into Profile" move as CopyProfileLinkButton
          (already rendered by ParametresForm's own pseudo block). */}
      <div className="mb-6 flex items-center justify-between">
        <span className="text-sm font-medium text-foreground-muted">{t("languageLabel")}</span>
        <LanguageSwitcher />
      </div>
      {/* Same "next to the language selector" placement, per the brief --
          theme itself lives in a cookie (never a users column, see
          CLAUDE.md), so the resolved value comes from this page's own
          cookie read above, not a DB query. */}
      <div className="mb-6 flex items-center justify-between">
        <span className="text-sm font-medium text-foreground-muted">{t("themeLabel")}</span>
        <ThemeSwitcher theme={theme} />
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
        badgeDonateurPublic={profil?.badge_donateur_public ?? false}
        photoUrl={photoUrl}
        couvertureUrl={couvertureUrl}
      />
      <div className="mt-4">
        <VerificationForm
          nomAffichage={profil?.nom_affichage ?? null}
          createurVerifie={profil?.createur_verifie ?? false}
          demandeActuelle={demandeActuelle}
        />
      </div>

      <div className="mt-4">
        <ParrainageCard
          userId={user.id}
          filleulsActifs={filleulsActifs}
          totalGagne={totalGagneParrainage}
        />
      </div>

      {/* Lot 3 merge follow-up: the former /dashboard page's own
          "Performance" content (rank badges, progress-towards-top-10,
          loyalty badges), moved here verbatim now that /dashboard no
          longer exists as its own route -- clearly delimited as its own
          section (border + heading) rather than blended into the
          settings above it. */}
      <section className="mt-6 flex flex-col gap-4 border-t border-border pt-6">
        <h2 className="text-lg font-bold">{tDashboard("heading")}</h2>

        {profil?.classement_public && (volumeRow || reactiviteRow || progressionRow) && (
          <div className="flex flex-wrap gap-2">
            {volumeRow && (
              <RankBadge kind="volume" label={tRanks("rankVolume", { rank: volumeRow.rang })} />
            )}
            {reactiviteRow && (
              <RankBadge
                kind="reactivite"
                label={tRanks("rankReactivite", { rank: reactiviteRow.rang })}
              />
            )}
            {progressionRow && (
              <RankBadge
                kind="progression"
                label={tRanks("rankProgression", { rank: progressionRow.rang })}
              />
            )}
          </div>
        )}

        {progres && <ClassementProgresCard progres={progres} />}

        {mesBadges.length > 0 && <BadgesFideliteCard badges={mesBadges} />}
      </section>
    </main>
  );
}
