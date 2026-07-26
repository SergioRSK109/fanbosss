import { redirect, Link } from "@/i18n/navigation";
import { BadgesFideliteCard } from "@/components/BadgesFideliteCard";
import { ClassementProgresCard } from "@/components/ClassementProgresCard";
import { CopyProfileLinkButton } from "@/components/CopyProfileLinkButton";
import { DemandesEnAttente } from "@/components/DemandesEnAttente";
import { LogoutButton } from "@/components/LogoutButton";
import { OffresManager } from "@/components/OffresManager";
import { TransactionActions } from "@/components/TransactionActions";
import { RankBadge } from "@/components/ui/RankBadge";
import { computePremieresTransactionsParPartenaire } from "@/lib/badgesFidelite";
import type { ProgresClassement } from "@/lib/classementProgres";
import { resolveDisplayName } from "@/lib/profil";
import { describeTransactionStatutFan } from "@/lib/transactions";
import type { OffreType } from "@/lib/validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Brief v3 point 1: there is no fan/créateur distinction anymore -- any
// user can both receive payments (offres) and send them to someone else,
// so this single page shows all three, in order: demandes they've
// received, their own offres settings, and payments they've sent to
// others (previously split across /dashboard and /mes-transactions).
const STATUT_STYLES: Record<string, string> = {
  en_attente: "bg-accent-500/15 text-accent-600",
  validee: "bg-brand-500/15 text-brand-600 dark:text-brand-300",
  livree: "bg-success-500/15 text-success-600",
  remboursee: "bg-foreground-muted/15 text-foreground-muted",
  refusee: "bg-danger-500/15 text-danger-600",
};

// Short at-a-glance badge -- the concrete deadline/detail sentence
// (describeTransactionStatutFan) is shown separately below it, never the
// raw technical statut string.
const STATUT_SHORT_LABELS: Record<string, string> = {
  en_attente: "En attente",
  validee: "Accepté",
  livree: "Livré",
  remboursee: "Remboursé",
  refusee: "Refusé",
};

export default async function DashboardPage({
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

  const [
    { data: offres },
    { data: demandes },
    { data: envoyees },
    { data: profil },
    { data: volumeRow },
    { data: reactiviteRow },
    { data: progressionRow },
    { data: progresRows },
    { data: transactionsLivrees },
  ] = await Promise.all([
    supabase
      .from("offres")
      .select("id, type, prix, libelle, actif, config")
      .eq("createur_id", user.id),
    supabase
      .from("transactions")
      .select("id, montant, deadline_acceptation, offres(type), created_at")
      .eq("createur_id", user.id)
      .eq("statut", "en_attente")
      .order("deadline_acceptation", { ascending: true }),
    supabase
      .from("transactions")
      .select("id, montant, statut, deadline_acceptation, deadline_livraison, offres(type)")
      .eq("fan_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("users")
      .select("pseudo, dernier_vu_demandes_at, classement_public")
      .eq("id", user.id)
      .single(),
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
  // stored -- same principle as campagnes_montant_collecte below).
  // Unconditional on badge_fidelite_public -- that flag only controls
  // whether OTHERS see this, never the fan's own private view of it.
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

  // Montant collecté per campagne, computed live via
  // campagnes_montant_collecte (migration 0017) -- same view the public
  // profile reads, so the dashboard's own numbers can never disagree with
  // what a fan sees. Only fetched when the créateur actually has a
  // campagne offre.
  const campagneIds = (offres ?? [])
    .filter((offre) => offre.type === "campagne")
    .map((offre) => offre.id);
  const { data: collecteRows } =
    campagneIds.length > 0
      ? await supabase
          .from("campagnes_montant_collecte")
          .select("offre_id, montant_collecte")
          .in("offre_id", campagneIds)
      : { data: [] as { offre_id: string; montant_collecte: number }[] };
  const montantCollecteParOffre = new Map(
    (collecteRows ?? []).map((row) => [row.offre_id, row.montant_collecte]),
  );

  // Notification badge: demandes created since the last time this page was
  // viewed count as "new". Compute the count first, then mark everything
  // as seen for next time.
  const dernierVu = profil?.dernier_vu_demandes_at;
  const nouvellesDemandes = (demandes ?? []).filter(
    (demande) => !dernierVu || new Date(demande.created_at) > new Date(dernierVu),
  ).length;

  await supabase
    .from("users")
    .update({ dernier_vu_demandes_at: new Date().toISOString() })
    .eq("id", user.id);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 p-5 pb-16 sm:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Mon espace FanBoss</h1>
        <div className="flex items-center gap-2">
          <Link
            href="/parametres"
            className="rounded-full border border-border px-3 py-1.5 text-sm font-medium text-foreground-muted transition-transform active:scale-95 hover:text-foreground"
          >
            ⚙️ Réglages
          </Link>
          <LogoutButton className="rounded-full border border-border px-3 py-1.5 text-sm font-medium text-foreground-muted transition-transform active:scale-95 hover:text-danger-600 disabled:opacity-50" />
        </div>
      </div>

      <div className="card flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
        <div>
          <span className="text-foreground-muted">Votre profil public : </span>
          {profil?.pseudo ? (
            <Link href={`/@${profil.pseudo}`} className="font-semibold text-brand-600 dark:text-brand-300">
              fanboss.app/@{profil.pseudo}
            </Link>
          ) : (
            <>
              <span className="text-foreground-muted">pas encore de pseudo — </span>
              <Link href="/parametres" className="font-semibold text-brand-600 dark:text-brand-300">
                en choisir un
              </Link>
            </>
          )}
        </div>
        {profil?.pseudo && <CopyProfileLinkButton pseudo={profil.pseudo} />}
      </div>

      {profil?.classement_public && (volumeRow || reactiviteRow || progressionRow) && (
        <div className="flex flex-wrap gap-2">
          {volumeRow && <RankBadge kind="volume" label={`#${volumeRow.rang} volume (30j)`} />}
          {reactiviteRow && (
            <RankBadge kind="reactivite" label={`#${reactiviteRow.rang} réactivité (30j)`} />
          )}
          {progressionRow && (
            <RankBadge kind="progression" label={`#${progressionRow.rang} progression (30j)`} />
          )}
        </div>
      )}

      {progres && <ClassementProgresCard progres={progres} />}

      {mesBadges.length > 0 && <BadgesFideliteCard badges={mesBadges} />}

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
          Demandes en attente de votre réponse
          {nouvellesDemandes > 0 && (
            <span className="rounded-full bg-accent-500 px-2 py-0.5 text-xs font-bold text-white">
              {nouvellesDemandes} nouvelle{nouvellesDemandes > 1 ? "s" : ""}
            </span>
          )}
        </h2>
        <DemandesEnAttente
          demandes={
            (demandes ?? []).map((demande) => ({
              ...demande,
              offres: Array.isArray(demande.offres)
                ? demande.offres[0]
                : demande.offres,
            })) as {
              id: string;
              montant: number;
              deadline_acceptation: string | null;
              offres: { type: OffreType } | null;
            }[]
          }
        />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">Vos offres</h2>
        <OffresManager
          offres={(
            (offres ?? []) as {
              id: string;
              type: OffreType;
              prix: number | null;
              libelle: string | null;
              actif: boolean;
              config: Record<string, unknown>;
            }[]
          ).map((offre) => ({
            ...offre,
            montantCollecte:
              offre.type === "campagne" ? montantCollecteParOffre.get(offre.id) ?? 0 : undefined,
          }))}
        />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">
          Paiements envoyés à d&apos;autres créateurs
        </h2>
        <ul className="flex flex-col gap-3">
          {(envoyees ?? []).map((transaction) => {
            const offre = Array.isArray(transaction.offres)
              ? transaction.offres[0]
              : transaction.offres;

            return (
              <li
                key={transaction.id}
                className="card flex flex-col gap-2 px-4 py-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">
                    {offre?.type} · {transaction.montant}$
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                      STATUT_STYLES[transaction.statut] ?? "bg-foreground-muted/15 text-foreground-muted"
                    }`}
                  >
                    {STATUT_SHORT_LABELS[transaction.statut] ?? transaction.statut}
                  </span>
                </div>
                <p className="text-xs text-foreground-muted">
                  {describeTransactionStatutFan({
                    statut: transaction.statut,
                    deadlineAcceptation: transaction.deadline_acceptation,
                    deadlineLivraison: transaction.deadline_livraison,
                  })}
                </p>
                {offre?.type && (
                  <TransactionActions
                    transactionId={transaction.id}
                    type={offre.type}
                    statut={transaction.statut}
                  />
                )}
              </li>
            );
          })}
          {(envoyees ?? []).length === 0 && (
            <p className="text-sm text-foreground-muted">Aucun paiement envoyé.</p>
          )}
        </ul>
      </section>
    </main>
  );
}
