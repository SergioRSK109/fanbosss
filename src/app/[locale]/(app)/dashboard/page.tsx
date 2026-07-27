import { getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { BadgesFideliteCard } from "@/components/BadgesFideliteCard";
import { ClassementProgresCard } from "@/components/ClassementProgresCard";
import { RankBadge } from "@/components/ui/RankBadge";
import { computePremieresTransactionsParPartenaire } from "@/lib/badgesFidelite";
import type { ProgresClassement } from "@/lib/classementProgres";
import { resolveDisplayName } from "@/lib/profil";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Lot 3: this page is now the "Performance" tab only -- ranking badges,
// the private progress-towards-top-10 card, and loyalty badges. It used
// to also hold the public-profile-link card (moved to the shared (app)
// layout, since it belongs to no single tab) and the demandes/offres
// sections (moved to the new /offres page). Still named DashboardPage /
// still the /dashboard URL -- that route is a pre-existing redirect
// target (post-login, post-signup) that must keep working unchanged; only
// this file's own content and the "Dashboard" i18n namespace it reads
// from are unchanged in name, per the same "don't rename what isn't
// user-visible" discipline as the Finance/finance split in Lot 2b.

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Dashboard" });
  const tRanks = await getTranslations({ locale, namespace: "CreateurProfile" });
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
    { data: volumeRow },
    { data: reactiviteRow },
    { data: progressionRow },
    { data: progresRows },
    { data: transactionsLivrees },
  ] = await Promise.all([
    supabase.from("users").select("classement_public").eq("id", user.id).single(),
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
  ]);

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
    (transactionsLivrees ?? []).map((t) => ({
      partenaireId: t.createur_id,
      createdAt: t.created_at,
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
    <main className="mx-auto flex max-w-2xl flex-col gap-8 p-5 sm:p-6">
      <h1 className="text-2xl font-bold">{t("heading")}</h1>

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
    </main>
  );
}
