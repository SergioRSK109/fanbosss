import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AdminTabs } from "@/components/admin/AdminTabs";
import type { StatutCompte } from "@/components/admin/AccountQuickActions";
import { AdminOffreTypeBarChart } from "@/components/admin/charts/AdminOffreTypeBarChart";
import { AdminStatChartCard } from "@/components/admin/charts/AdminStatChartCard";
import { GestionAdminsManager, type AdminManageableUser } from "@/components/admin/GestionAdminsManager";
import { GestionComptesManager, type AccountManageableUser } from "@/components/admin/GestionComptesManager";
import { LitigesManager, type LitigeEnAttente } from "@/components/admin/LitigesManager";
import { PublicationsSignaleesManager } from "@/components/admin/PublicationsSignaleesManager";
import {
  RemboursementsManuelsManager,
  type RemboursementManuel,
} from "@/components/admin/RemboursementsManuelsManager";
import { RetraitsManager, type DemandeRetraitAdmin } from "@/components/admin/RetraitsManager";
import {
  VerificationsManager,
  type DemandeVerificationAdmin,
} from "@/components/admin/VerificationsManager";
import {
  buildPublicationSignalee,
  type PublicationOriginalRow,
  type PublicationSignalee,
} from "@/lib/adminPublicationsSignalees";
import {
  ADMIN_STATS_WINDOW_DAYS,
  buildDailyCountSeries,
  buildDailySumSeries,
  computeOffreTypeBreakdown,
  computeStatsWindowStartIso,
  isActiveWithinWindow,
} from "@/lib/adminStats";
import { resolveDisplayName } from "@/lib/profil";
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import type { OffreType } from "@/lib/validation";
import type { PlateformeVerification } from "@/lib/verification";

// Business admin dashboard, gated by users.est_admin -- a real DB-level
// invariant (migration 0015's trigger), not just this check. A non-admin
// visitor (logged out, or logged in but not admin) gets a real 404, never
// a redirect -- a redirect to /login would itself reveal this page exists
// and is auth-gated, exactly the kind of leak brief explicitly asked to
// avoid.
export default async function AdminPage() {
  const t = await getTranslations("Admin");
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    notFound();
  }

  const { data: profil } = await supabase
    .from("users")
    .select("est_admin")
    .eq("id", user.id)
    .single();

  if (!profil?.est_admin) {
    notFound();
  }

  // Everything below reads across every user/transaction, far beyond what
  // users_select_self/RLS would ever allow this account directly -- safe
  // here specifically because the est_admin check above already
  // re-verified this exact caller server-side, same "verify with the real
  // client first, then use service-role for the privileged read" pattern
  // as the whatsapp-link/content-url delivery routes.
  const serviceSupabase = createSupabaseServiceRoleClient();

  const now = new Date();
  const startOfMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  ).toISOString();
  // "Vue d'ensemble" time-series charts (see CLAUDE.md's own section for
  // the full account) -- one shared window start, computed the same way
  // the daily buckets themselves are, so the SQL filter and the chart's
  // own bucket range can never drift apart (see adminStats.ts's own
  // comment on computeStatsWindowStartIso for why a separately-computed
  // `now - 30*24h` threshold would risk exactly that).
  const statsWindowStart = computeStatsWindowStartIso(ADMIN_STATS_WINDOW_DAYS, now);

  const [
    { data: monthTransactions },
    { data: manualRefundRows },
    { data: litigeRows },
    { data: retraitRows },
    { data: allUsers },
    { data: authUsersPage },
    { data: verificationRows },
    { data: signalementRows },
    { data: paiementsReussisRows },
    { data: avertissementRows },
    { data: statsTransactions },
    { data: statsPaiements },
    { data: statsPublications },
    { data: produitOffresActives },
    { count: concoursCount },
  ] = await Promise.all([
    serviceSupabase
      .from("transactions")
      .select("id, montant, createur_id")
      .gte("created_at", startOfMonth),
    serviceSupabase
      .from("transactions")
      .select("id, montant, created_at, createur_id, fan_id")
      .eq("necessite_remboursement_manuel", true)
      .order("created_at", { ascending: true }),
    // Lot 2a: video/shoutout deliveries a fan flagged as a problem
    // (migration 0025) -- confirmation_fan only ever reaches 'conteste'
    // for those two types, so no extra type filter is needed here.
    // Lot 2a-bis: `.is("litige_resolu_at", null)` excludes a litige an
    // admin already resolved (migration 0026) -- without it, a resolved
    // dispute would stay listed forever, since resolving one never
    // changes confirmation_fan away from 'conteste' for the faveur_fan
    // branch (see resoudre_litige()). Ordered by conteste_at (migration
    // 0042), the actual dispute date, not created_at (the payment date)
    // -- the SLA in the CGU (article 6.3) runs from the dispute, so the
    // longest-*disputed* litige is the one that needs to surface first,
    // not the one whose underlying transaction is oldest. `nullsFirst:
    // false` pushes a pre-migration litige with no known conteste_at to
    // the end rather than (wrongly) treating an unknown age as the most
    // urgent.
    serviceSupabase
      .from("transactions")
      .select("id, montant, created_at, conteste_at, createur_id, fan_id, offres(type)")
      .eq("confirmation_fan", "conteste")
      .is("litige_resolu_at", null)
      .order("conteste_at", { ascending: true, nullsFirst: false }),
    // Lot 2b: withdrawal requests awaiting an admin decision (migration
    // 0027) -- oldest first, same operational-queue principle as the
    // manual-refunds/litiges worklists above.
    serviceSupabase
      .from("demandes_retrait")
      .select("id, montant, createur_id, demande_at")
      .eq("statut", "en_attente")
      .order("demande_at", { ascending: true }),
    // `date_creation` added for the "Vue d'ensemble" inscriptions/jour
    // chart below -- reusing this same full-user-list query rather than
    // a second, near-duplicate one, same "one fetch, filter/derive in
    // JS" pattern this admin page already uses elsewhere on this file.
    serviceSupabase
      .from("users")
      .select(
        "id, pseudo, nom_affichage, est_admin, statut_compte, statut_compte_raison, date_creation",
      ),
    serviceSupabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    // Only the two actionable statuses -- an approved/refused demande no
    // longer needs an admin decision, see VerificationsManager.
    serviceSupabase
      .from("demandes_verification")
      .select("id, createur_id, plateforme, lien_compte, code_verification, statut")
      .in("statut", ["en_attente", "conflit"])
      .order("created_at", { ascending: true }),
    // Lot 5b: publications a fan/créateur flagged (migration 0030) --
    // oldest first, same operational-queue principle as the other admin
    // worklists. `.not("publication_id", "is", null)` scopes this to
    // publication reports only -- the pre-existing WhatsApp-adjacent
    // report flow (ReportButton.tsx) never sets that column, so those
    // rows never show up here. `repost_de_id` is selected so a
    // signalement on a repost can be resolved to its original's real
    // contenu below (a repost's own contenu is always null -- see
    // buildPublicationSignalee()). `type` is selected too (migration
    // 0054) -- the real, explicit signal for an automatic signalement,
    // never inferred from reporter_id's own nullability.
    serviceSupabase
      .from("reports")
      .select(
        "id, type, raison, created_at, reporter_id, reported_user_id, publications(id, contenu, repost_de_id)",
      )
      .not("publication_id", "is", null)
      .eq("statut", "en_attente")
      .order("created_at", { ascending: true }),
    // Lot B: donor ranking (migration 0051) -- the exact same
    // `paiements.statut_paiement = 'reussi'` basis badges_donateur_publics
    // itself sums, read directly here instead of through that view since
    // this ranking must show EVERY fan regardless of badge_donateur_public
    // -- the whole point of this admin-only list is that the opt-in never
    // hides anyone from the platform owner. All-time cumulative, not
    // scoped to this month (unlike topCreateurs above) -- "dépense totale
    // cumulée" is the same all-time definition calculer_palier_donateur()
    // itself is computed against.
    serviceSupabase
      .from("paiements")
      .select("montant_brut, transactions(fan_id)")
      .eq("statut_paiement", "reussi"),
    // Admin warning mechanism (migration 0053) -- every avertissement
    // ever issued, most recent first, grouped by user below for
    // GestionComptesManager's own history display. Unlike the worklists
    // above, this isn't a queue an admin works through (there's no
    // "pending" state to clear -- vu_at is the RECIPIENT's own read
    // marker, not an admin action), so it's read in full rather than
    // filtered to some "en_attente"-equivalent status.
    serviceSupabase
      .from("avertissements")
      .select("id, user_id, raison, emis_at, vu_at")
      .order("emis_at", { ascending: false }),
    // Vue d'ensemble charts, computed live, no cache table -- same
    // discipline as montant_collecte/solde_wallet_createur elsewhere in
    // this project (see CLAUDE.md). GMV/jour + répartition par type
    // d'offre share this one query: every status is included (gross,
    // same "brut" definition monthTransactions/gmvBrut above already
    // use), joined to offres(type) for the breakdown.
    serviceSupabase
      .from("transactions")
      .select("montant, created_at, offres(type)")
      .gte("created_at", statsWindowStart),
    // Revenu réel FanBoss/jour -- commission_plateforme, distinct from
    // the GMV brut above (see CLAUDE.md for why paiements.created_at,
    // not transactions.created_at, is the right anchor here). Every row
    // regardless of statut_paiement, same unadjusted "brut" philosophy
    // as GMV -- a later refund doesn't retroactively zero out the
    // commission that was actually recorded at validation time.
    serviceSupabase
      .from("paiements")
      .select("commission_plateforme, created_at")
      .gte("created_at", statsWindowStart),
    serviceSupabase
      .from("publications")
      .select("created_at")
      .gte("created_at", statsWindowStart),
    // Adoption: distinct créateurs with >= 1 active `produit` offer.
    serviceSupabase
      .from("offres")
      .select("createur_id")
      .eq("type", "produit")
      .eq("actif", true),
    // Adoption: total concours ever created (all-time, not windowed --
    // a simple cumulative count, per the brief's own "chiffres simples,
    // pas nécessairement en courbe").
    serviceSupabase.from("concours").select("id", { count: "exact", head: true }),
  ]);

  const userLabelById = new Map(
    (allUsers ?? []).map((u) => [
      u.id,
      resolveDisplayName(u.nom_affichage, u.pseudo) ?? t("noName"),
    ]),
  );
  const pseudoById = new Map((allUsers ?? []).map((u) => [u.id, u.pseudo]));
  // Account suspension/ban (migration 0052) -- current statut_compte per
  // user, feeding both AccountQuickActions call sites (Litiges,
  // Publications signalées) and the standalone "Gestion des comptes"
  // tool below.
  const statutCompteById = new Map(
    (allUsers ?? []).map((u) => [u.id, u.statut_compte as StatutCompte]),
  );

  // Vue d'ensemble du mois en cours -- gross (all statuses, including
  // refused/refunded): "brut" is deliberately unadjusted, see CLAUDE.md.
  const transactionCount = monthTransactions?.length ?? 0;
  const gmvBrut = (monthTransactions ?? []).reduce(
    (sum, t) => sum + Number(t.montant),
    0,
  );
  const createursActifsCount = new Set(
    (monthTransactions ?? []).map((t) => t.createur_id),
  ).size;

  // "Vue d'ensemble" time-series charts -- computed live from the raw
  // rows fetched above, no new cache table (same discipline as
  // montant_collecte/solde_wallet_createur, see CLAUDE.md's own section
  // on this feature for the full account, including why "actif" means
  // "signed in within ADMIN_STATS_WINDOW_DAYS days").
  const totalInscritsCount = (allUsers ?? []).length;
  const utilisateursActifsCount = (authUsersPage?.users ?? []).filter((u) =>
    isActiveWithinWindow(u.last_sign_in_at ?? null, ADMIN_STATS_WINDOW_DAYS, now),
  ).length;
  const inscriptionsParJour = buildDailyCountSeries(
    (allUsers ?? [])
      .map((u) => u.date_creation)
      .filter((d): d is string => Boolean(d)),
    ADMIN_STATS_WINDOW_DAYS,
    now,
  );

  // GMV/jour + répartition par type d'offre share one query (see above)
  // -- `offres(type)` is a to-one embed but Supabase/PostgREST still
  // types it as an array, same shape already handled for litigeRows.
  const statsTransactionsWithType = (statsTransactions ?? []).map((row) => {
    const offre = Array.isArray(row.offres) ? row.offres[0] : row.offres;
    return {
      montant: Number(row.montant),
      createdAt: row.created_at,
      type: offre?.type as OffreType | undefined,
    };
  });
  const gmvParJour = buildDailySumSeries(
    statsTransactionsWithType.map((row) => ({ timestamp: row.createdAt, amount: row.montant })),
    ADMIN_STATS_WINDOW_DAYS,
    now,
  );
  const offreTypeBreakdown = computeOffreTypeBreakdown(
    statsTransactionsWithType
      .filter((row): row is typeof row & { type: OffreType } => row.type !== undefined)
      .map((row) => ({ type: row.type, montant: row.montant })),
  );

  const revenuParJour = buildDailySumSeries(
    (statsPaiements ?? []).map((row) => ({
      timestamp: row.created_at,
      amount: Number(row.commission_plateforme),
    })),
    ADMIN_STATS_WINDOW_DAYS,
    now,
  );

  const publicationsParJour = buildDailyCountSeries(
    (statsPublications ?? []).map((row) => row.created_at),
    ADMIN_STATS_WINDOW_DAYS,
    now,
  );

  const createursProduitActifsCount = new Set(
    (produitOffresActives ?? []).map((row) => row.createur_id),
  ).size;

  // Top 10 créateurs par volume ce mois -- same gross basis as GMV brut
  // above, for one consistent definition of "volume" on this page.
  const volumeByCreateur = new Map<string, number>();
  for (const t of monthTransactions ?? []) {
    volumeByCreateur.set(
      t.createur_id,
      (volumeByCreateur.get(t.createur_id) ?? 0) + Number(t.montant),
    );
  }
  const topCreateurs = [...volumeByCreateur.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([createurId, volume]) => ({
      createurId,
      label: userLabelById.get(createurId) ?? t("deletedUser"),
      volume,
    }));

  // Top 20 donateurs, dépense cumulée sur toute la vie du compte (Lot B,
  // migration 0051) -- deliberately ignores badge_donateur_public, see
  // the query's own comment above.
  const depenseByFan = new Map<string, number>();
  for (const row of paiementsReussisRows ?? []) {
    const tx = Array.isArray(row.transactions) ? row.transactions[0] : row.transactions;
    const fanId = tx?.fan_id;
    if (!fanId) continue;
    depenseByFan.set(fanId, (depenseByFan.get(fanId) ?? 0) + Number(row.montant_brut));
  }
  const topDonateurs = [...depenseByFan.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([fanId, total]) => ({
      fanId,
      label: userLabelById.get(fanId) ?? t("deletedUser"),
      total,
    }));

  const remboursementsManuels: RemboursementManuel[] = (manualRefundRows ?? []).map((row) => ({
    id: row.id,
    montant: Number(row.montant),
    createdAt: row.created_at,
    createurLabel: userLabelById.get(row.createur_id) ?? t("deletedUser"),
    fanLabel: userLabelById.get(row.fan_id) ?? t("deletedUser"),
  }));

  const litiges: LitigeEnAttente[] = (litigeRows ?? []).map((row) => {
    const offre = Array.isArray(row.offres) ? row.offres[0] : row.offres;
    return {
      id: row.id,
      montant: Number(row.montant),
      offreType: (offre?.type ?? "video") as OffreType,
      createdAt: row.created_at,
      contesteAt: row.conteste_at,
      createurId: row.createur_id,
      createurLabel: userLabelById.get(row.createur_id) ?? t("deletedUser"),
      createurStatutCompte: statutCompteById.get(row.createur_id) ?? "actif",
      fanId: row.fan_id,
      fanLabel: userLabelById.get(row.fan_id) ?? t("deletedUser"),
      fanStatutCompte: statutCompteById.get(row.fan_id) ?? "actif",
    };
  });

  const retraits: DemandeRetraitAdmin[] = (retraitRows ?? []).map((row) => ({
    id: row.id,
    montant: Number(row.montant),
    demandeAt: row.demande_at,
    createurLabel: userLabelById.get(row.createur_id) ?? t("deletedUser"),
  }));

  const emailById = new Map(
    (authUsersPage?.users ?? []).map((u) => [u.id, u.email ?? null]),
  );

  const manageableUsers: AdminManageableUser[] = (allUsers ?? [])
    .map((u) => ({
      id: u.id,
      email: emailById.get(u.id) ?? null,
      label: resolveDisplayName(u.nom_affichage, u.pseudo) ?? u.id,
      estAdmin: u.est_admin,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // Admin warning mechanism (migration 0053) -- grouped by user_id,
  // already sorted most-recent-first by the query itself above.
  const avertissementsByUserId = new Map<
    string,
    { id: string; raison: string; emisAt: string; vuAt: string | null }[]
  >();
  for (const row of avertissementRows ?? []) {
    const list = avertissementsByUserId.get(row.user_id) ?? [];
    list.push({ id: row.id, raison: row.raison, emisAt: row.emis_at, vuAt: row.vu_at });
    avertissementsByUserId.set(row.user_id, list);
  }

  // Account suspension/ban (migration 0052) -- "Gestion des comptes",
  // same full-user-list-as-props shape as manageableUsers above
  // (GestionComptesManager itself filters client-side by pseudo/label,
  // see its own comment for why a dedicated search route wasn't built).
  const manageableAccounts: AccountManageableUser[] = (allUsers ?? [])
    .map((u) => ({
      id: u.id,
      pseudo: u.pseudo,
      label: resolveDisplayName(u.nom_affichage, u.pseudo) ?? u.id,
      statutCompte: u.statut_compte as StatutCompte,
      statutCompteRaison: u.statut_compte_raison,
      avertissements: avertissementsByUserId.get(u.id) ?? [],
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const statutComptesByIdRecord: Record<string, StatutCompte> = Object.fromEntries(
    statutCompteById,
  );

  const verifications: DemandeVerificationAdmin[] = (verificationRows ?? []).map((d) => ({
    id: d.id,
    createurLabel: userLabelById.get(d.createur_id) ?? t("deletedUser"),
    plateforme: d.plateforme as PlateformeVerification,
    lienCompte: d.lien_compte,
    codeVerification: d.code_verification,
    statut: d.statut as "en_attente" | "conflit",
  }));

  // A signalement on a repost carries a repost row whose own `contenu` is
  // always null (publications_contenu_coherent) -- fetch the referenced
  // original's real contenu (and its author, for the "Repost de X"
  // indicator) in one follow-up batch, run after the main Promise.all
  // since it depends on which repost_de_id values actually showed up.
  const reportedRepostOriginalIds = [
    ...new Set(
      (signalementRows ?? [])
        .map((row) => {
          const publication = Array.isArray(row.publications) ? row.publications[0] : row.publications;
          return publication?.repost_de_id ?? null;
        })
        .filter((id): id is string => id !== null),
    ),
  ];

  const { data: repostOriginalRows } =
    reportedRepostOriginalIds.length > 0
      ? await serviceSupabase
          .from("publications")
          .select("id, contenu, auteur_id")
          .in("id", reportedRepostOriginalIds)
      : { data: [] as { id: string; contenu: string | null; auteur_id: string }[] };

  const originalById = new Map<string, PublicationOriginalRow>(
    (repostOriginalRows ?? []).map((r) => [
      r.id,
      { id: r.id, contenu: r.contenu, auteurId: r.auteur_id },
    ]),
  );

  const publicationsSignalees: PublicationSignalee[] = (signalementRows ?? []).map((row) => {
    const publication = Array.isArray(row.publications) ? row.publications[0] : row.publications;
    return buildPublicationSignalee(
      {
        reportId: row.id,
        type: row.type,
        raison: row.raison,
        createdAt: row.created_at,
        reporterId: row.reporter_id,
        reportedUserId: row.reported_user_id,
        publication: publication
          ? { id: publication.id, contenu: publication.contenu, repostDeId: publication.repost_de_id }
          : null,
      },
      originalById,
      pseudoById,
      userLabelById,
      t("deletedUser"),
      t("publicationsSignalees.automatique"),
    );
  });

  // Financier/Contenu & confiance are the only two tabs with a real
  // "en attente" notion -- Vue d'ensemble and Administration are plain
  // reads with nothing to triage, so AdminTabs never shows a badge for
  // either (see its own prop comment).
  const financierCount = remboursementsManuels.length + litiges.length + retraits.length;
  const contenuConfianceCount = verifications.length + publicationsSignalees.length;

  const overviewContent = (
    <>
      <section>
        <h2 className="mb-3 text-lg font-bold">{t("overviewHeading")}</h2>
        <div className="grid grid-cols-3 gap-3">
          <div className="card px-4 py-3 text-center">
            <div className="text-2xl font-bold">{transactionCount}</div>
            <div className="text-xs text-foreground-muted">{t("statTransactions")}</div>
          </div>
          <div className="card px-4 py-3 text-center">
            <div className="text-2xl font-bold">{gmvBrut.toFixed(0)}$</div>
            <div className="text-xs text-foreground-muted">{t("statGmvBrut")}</div>
          </div>
          <div className="card px-4 py-3 text-center">
            <div className="text-2xl font-bold">{createursActifsCount}</div>
            <div className="text-xs text-foreground-muted">{t("statCreateursActifs")}</div>
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">{t("usersHeading")}</h2>
        <div className="mb-3 grid grid-cols-2 gap-3">
          <div className="card px-4 py-3 text-center">
            <div className="text-2xl font-bold">{totalInscritsCount}</div>
            <div className="text-xs text-foreground-muted">{t("statTotalInscrits")}</div>
          </div>
          <div className="card px-4 py-3 text-center">
            <div className="text-2xl font-bold">{utilisateursActifsCount}</div>
            <div className="text-xs text-foreground-muted">{t("statUtilisateursActifs")}</div>
          </div>
        </div>
        <AdminStatChartCard
          title={t("chartInscriptionsTitle")}
          data={inscriptionsParJour}
          color="var(--color-success-500)"
          unit="count"
        />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">{t("argentHeading")}</h2>
        <div className="flex flex-col gap-3">
          <AdminStatChartCard
            title={t("chartGmvTitle")}
            data={gmvParJour}
            color="var(--color-brand-500)"
            unit="currency"
          />
          <AdminStatChartCard
            title={t("chartRevenuTitle")}
            data={revenuParJour}
            color="var(--color-accent-500)"
            unit="currency"
          />
          <div className="card p-4">
            <h3 className="mb-2 text-sm font-semibold text-foreground-muted">
              {t("chartBreakdownTitle")}
            </h3>
            <AdminOffreTypeBarChart data={offreTypeBreakdown} color="var(--color-brand-500)" />
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">{t("activiteHeading")}</h2>
        <div className="mb-3 grid grid-cols-2 gap-3">
          <div className="card px-4 py-3 text-center">
            <div className="text-2xl font-bold">{createursProduitActifsCount}</div>
            <div className="text-xs text-foreground-muted">{t("statCreateursProduit")}</div>
          </div>
          <div className="card px-4 py-3 text-center">
            <div className="text-2xl font-bold">{concoursCount ?? 0}</div>
            <div className="text-xs text-foreground-muted">{t("statConcours")}</div>
          </div>
        </div>
        <AdminStatChartCard
          title={t("chartPublicationsTitle")}
          data={publicationsParJour}
          color="var(--color-brand-400)"
          unit="count"
        />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">{t("topCreateursHeading")}</h2>
        {topCreateurs.length === 0 ? (
          <p className="text-sm text-foreground-muted">{t("topCreateursEmpty")}</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {topCreateurs.map((c, index) => (
              <li
                key={c.createurId}
                className="card flex items-center justify-between px-4 py-3"
              >
                <span className="text-sm font-medium">
                  #{index + 1} {c.label}
                </span>
                <span className="text-sm font-semibold text-brand-600 dark:text-brand-300">
                  {c.volume.toFixed(0)}$
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">{t("topDonateursHeading")}</h2>
        <p className="mb-3 text-sm text-foreground-muted">{t("topDonateursIntro")}</p>
        {topDonateurs.length === 0 ? (
          <p className="text-sm text-foreground-muted">{t("topDonateursEmpty")}</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {topDonateurs.map((d, index) => (
              <li key={d.fanId} className="card flex items-center justify-between px-4 py-3">
                <span className="text-sm font-medium">
                  #{index + 1} {d.label}
                </span>
                <span className="text-sm font-semibold text-brand-600 dark:text-brand-300">
                  {d.total.toFixed(0)}$
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );

  const financierContent = (
    <>
      <section>
        <h2 className="mb-3 text-lg font-bold">
          {t("remboursementsHeading")}
          {remboursementsManuels.length > 0 && (
            <span className="ml-2 rounded-full bg-accent-500 px-2 py-0.5 text-xs font-bold text-white">
              {remboursementsManuels.length}
            </span>
          )}
        </h2>
        <p className="mb-3 text-sm text-foreground-muted">{t("remboursementsIntro")}</p>
        <RemboursementsManuelsManager remboursements={remboursementsManuels} />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">
          {t("litigesHeading")}
          {litiges.length > 0 && (
            <span className="ml-2 rounded-full bg-accent-500 px-2 py-0.5 text-xs font-bold text-white">
              {litiges.length}
            </span>
          )}
        </h2>
        <p className="mb-3 text-sm text-foreground-muted">{t("litigesIntro")}</p>
        <LitigesManager litiges={litiges} />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">
          {t("retraitsHeading")}
          {retraits.length > 0 && (
            <span className="ml-2 rounded-full bg-accent-500 px-2 py-0.5 text-xs font-bold text-white">
              {retraits.length}
            </span>
          )}
        </h2>
        <p className="mb-3 text-sm text-foreground-muted">{t("retraitsIntro")}</p>
        <RetraitsManager demandes={retraits} />
      </section>
    </>
  );

  const contenuConfianceContent = (
    <>
      <section>
        <h2 className="mb-3 text-lg font-bold">{t("verificationHeading")}</h2>
        <p className="mb-3 text-sm text-foreground-muted">{t("verificationIntro")}</p>
        <VerificationsManager demandes={verifications} />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">
          {t("publicationsSignaleesHeading")}
          {publicationsSignalees.length > 0 && (
            <span className="ml-2 rounded-full bg-accent-500 px-2 py-0.5 text-xs font-bold text-white">
              {publicationsSignalees.length}
            </span>
          )}
        </h2>
        <p className="mb-3 text-sm text-foreground-muted">{t("publicationsSignaleesIntro")}</p>
        <PublicationsSignaleesManager
          signalements={publicationsSignalees}
          statutComptesById={statutComptesByIdRecord}
        />
      </section>
    </>
  );

  const administrationContent = (
    <>
      <section>
        <h2 className="mb-3 text-lg font-bold">{t("gestionAdminsHeading")}</h2>
        <GestionAdminsManager users={manageableUsers} />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">{t("gestionComptesHeading")}</h2>
        <p className="mb-3 text-sm text-foreground-muted">{t("gestionComptesIntro")}</p>
        <GestionComptesManager users={manageableAccounts} />
      </section>
    </>
  );

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 p-5 pb-16 sm:p-6">
      <h1 className="text-2xl font-bold">{t("heading")}</h1>

      <AdminTabs
        overviewContent={overviewContent}
        financierContent={financierContent}
        contenuConfianceContent={contenuConfianceContent}
        administrationContent={administrationContent}
        financierCount={financierCount}
        contenuConfianceCount={contenuConfianceCount}
      />
    </main>
  );
}
