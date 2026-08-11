import { getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { RetraitRequestForm } from "@/components/RetraitRequestForm";
import { TransactionActions } from "@/components/TransactionActions";
import { formatMontant } from "@/lib/campagnes";
import { computeDateExpirationAcces } from "@/lib/contenuDebloque";
import { describeTransactionStatutFan } from "@/lib/transactions";
import { classifyPaiementRecu } from "@/lib/wallet";
import type { OffreType } from "@/lib/validation";
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";

// Lot 2b: standalone wallet/finance page. Reuses the exact same envoyées
// query/rendering that used to live on /dashboard (TransactionActions,
// describeTransactionStatutFan, the "Dashboard" translation namespace for
// those generic per-transaction strings) -- moved here verbatim rather
// than duplicated, to avoid the section existing in two places at once.
// Lot 3: now one of the 4 AppTabBar destinations ("Paiements") -- the
// "back to dashboard" link this page used to show is gone, since the tab
// bar itself is the nav now.
const ENVOYEE_STATUT_STYLES: Record<string, string> = {
  en_attente: "bg-accent-500/15 text-accent-600",
  validee: "bg-brand-500/15 text-brand-600 dark:text-brand-300",
  livree: "bg-success-500/15 text-success-600",
  remboursee: "bg-foreground-muted/15 text-foreground-muted",
  refusee: "bg-danger-500/15 text-danger-600",
};

const RECU_BUCKET_STYLES: Record<string, string> = {
  en_attente_livraison: "bg-accent-500/15 text-accent-600",
  en_litige: "bg-danger-500/15 text-danger-600",
  disponible: "bg-success-500/15 text-success-600",
  rembourse: "bg-foreground-muted/15 text-foreground-muted",
  autre: "bg-foreground-muted/15 text-foreground-muted",
};

export default async function FinancePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Finance" });
  const tDashboard = await getTranslations({ locale, namespace: "Dashboard" });
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect({ href: "/login", locale });
    return;
  }

  const [{ data: soldeRows }, { data: recues }, { data: envoyeesRaw }] = await Promise.all([
    // Same shared query solde_wallet_createur() exposes to
    // demander_retrait() -- never a second, hand-duplicated computation
    // of these three buckets (migration 0027).
    supabase.rpc("solde_wallet_createur", { p_createur_id: user.id }),
    supabase
      .from("transactions")
      .select(
        "id, montant, statut, created_at, confirmation_fan, litige_resolu_at, offres(type), paiements(montant_net_createur, statut_paiement)",
      )
      .eq("createur_id", user.id)
      .order("created_at", { ascending: false }),
    // A real bug, found and fixed while adding the content-expiry
    // feature below: this used to embed offres(type) directly (an
    // authenticated-client select from `transactions`), which silently
    // came back null for every row here -- offres_select_own (migration
    // 0003/0006) only ever lets a créateur read their OWN offres, and
    // the caller on this specific query is the FAN, not the offer's
    // owner. Verified directly against a real Postgres instance with the
    // real Supabase base grants replicated (this project's local
    // stub_auth.sql harness doesn't grant them, so this couldn't be
    // caught by the SQL checklist) -- the embed genuinely returns NULL
    // for a non-owning fan, not an error, so nothing here ever crashed;
    // it just meant `offre?.type` was always falsy, {offre?.type &&
    // <TransactionActions .../>} never rendered, and no fan has ever
    // been able to click "Obtenir le lien WhatsApp"/"Voir ma
    // vidéo"/etc. from this page. Fixed below by resolving the type via
    // offres_publiques (the public view, safe for any caller) instead of
    // a direct embed against the RLS-restricted raw table.
    supabase
      .from("transactions")
      .select(
        "id, montant, statut, created_at, offre_id, deadline_acceptation, deadline_livraison, confirmation_fan, deadline_confirmation",
      )
      .eq("fan_id", user.id)
      .order("created_at", { ascending: false }),
  ]);

  const offreIds = Array.from(
    new Set((envoyeesRaw ?? []).map((t) => t.offre_id).filter((id): id is string => Boolean(id))),
  );
  const { data: offresPubliques } =
    offreIds.length > 0
      ? await supabase.from("offres_publiques").select("id, type").in("id", offreIds)
      : { data: [] as { id: string; type: string }[] };
  const typeByOffreId = new Map((offresPubliques ?? []).map((o) => [o.id, o.type as OffreType]));

  // contenu_debloque's duree_acces_jours (this lot's own feature) lives
  // in `config`, which offres_publiques deliberately never exposes
  // (evenement_live's own config holds a pre-payment secret link -- see
  // CLAUDE.md). Read via the service-role client instead, the exact same
  // "an authenticated route needs to bypass RLS for a specific,
  // already-authorized read" pattern content-url's own route already
  // uses -- safe here because offreIds/typeByOffreId above were already
  // resolved from the fan's own RLS-verified transactions, and this read
  // is scoped to only their contenu_debloque offers.
  const contenuDebloqueOffreIds = offreIds.filter((id) => typeByOffreId.get(id) === "contenu_debloque");
  const serviceSupabase = createSupabaseServiceRoleClient();
  const { data: contenuConfigs } =
    contenuDebloqueOffreIds.length > 0
      ? await serviceSupabase.from("offres").select("id, config").in("id", contenuDebloqueOffreIds)
      : { data: [] as { id: string; config: Record<string, unknown> }[] };
  const dureeAccesJoursByOffreId = new Map(
    (contenuConfigs ?? []).map((o) => [
      o.id,
      (o.config as { duree_acces_jours?: number } | null)?.duree_acces_jours ?? null,
    ]),
  );

  // Comparing against the current wall clock here (a Server Component,
  // evaluated once per request) is fine -- it's the client-side
  // TransactionActions component (re-rendered interactively) where doing
  // this directly would violate React's render-purity rule; see that
  // component's own comment.
  const now = new Date();
  const envoyees = (envoyeesRaw ?? []).map((transaction) => {
    const offreType = transaction.offre_id ? (typeByOffreId.get(transaction.offre_id) ?? null) : null;
    const dureeAccesJours = transaction.offre_id
      ? (dureeAccesJoursByOffreId.get(transaction.offre_id) ?? null)
      : null;
    const expirationDate =
      offreType === "contenu_debloque"
        ? computeDateExpirationAcces(transaction.created_at, dureeAccesJours)
        : null;
    return {
      ...transaction,
      offreType,
      expirationDateIso: expirationDate?.toISOString() ?? null,
      accesExpire: expirationDate ? expirationDate.getTime() <= now.getTime() : false,
    };
  });

  const soldeRow = soldeRows?.[0] as
    | { en_attente_livraison: number; en_litige: number; net_a_retirer: number }
    | undefined;
  const enAttenteLivraison = Number(soldeRow?.en_attente_livraison ?? 0);
  const enLitige = Number(soldeRow?.en_litige ?? 0);
  const netARetirer = Number(soldeRow?.net_a_retirer ?? 0);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 p-5 sm:p-6">
      <h1 className="text-2xl font-bold">{t("heading")}</h1>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="card px-4 py-3">
          <div className="text-xs text-foreground-muted">{t("blocEnAttenteLivraison")}</div>
          <div className="text-xl font-bold">{formatMontant(enAttenteLivraison, locale)}$</div>
        </div>
        <div className="card px-4 py-3">
          <div className="text-xs text-foreground-muted">{t("blocEnLitige")}</div>
          <div className="text-xl font-bold">{formatMontant(enLitige, locale)}$</div>
        </div>
        <div className="card px-4 py-3">
          <div className="text-xs text-foreground-muted">{t("blocNetARetirer")}</div>
          <div className="text-xl font-bold text-brand-600 dark:text-brand-300">
            {formatMontant(netARetirer, locale)}$
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">{t("retraitHeading")}</h2>
        <RetraitRequestForm netARetirer={netARetirer} />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">{t("historiqueRecuHeading")}</h2>
        <ul className="flex flex-col gap-3">
          {(recues ?? []).map((transaction) => {
            const offre = Array.isArray(transaction.offres)
              ? transaction.offres[0]
              : transaction.offres;
            const paiement = Array.isArray(transaction.paiements)
              ? transaction.paiements[0]
              : transaction.paiements;
            const bucket = classifyPaiementRecu({
              statutPaiement: paiement?.statut_paiement ?? null,
              confirmationFan: transaction.confirmation_fan,
              litigeResoluAt: transaction.litige_resolu_at,
            });

            return (
              <li key={transaction.id} className="card flex flex-col gap-2 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">
                    {offre?.type} · {transaction.montant}$
                    {paiement && ` (net ${paiement.montant_net_createur}$)`}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                      RECU_BUCKET_STYLES[bucket] ?? "bg-foreground-muted/15 text-foreground-muted"
                    }`}
                  >
                    {bucket === "autre"
                      ? tDashboard.has(`statutShort.${transaction.statut}`)
                        ? tDashboard(`statutShort.${transaction.statut}`)
                        : transaction.statut
                      : t(`historiqueRecuBucket.${bucket}`)}
                  </span>
                </div>
              </li>
            );
          })}
          {(recues ?? []).length === 0 && (
            <p className="text-sm text-foreground-muted">{t("noHistoriqueRecu")}</p>
          )}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">{t("historiqueEnvoyeHeading")}</h2>
        <ul className="flex flex-col gap-3">
          {(envoyees ?? []).map((transaction) => (
            <li key={transaction.id} className="card flex flex-col gap-2 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">
                  {transaction.offreType} · {transaction.montant}$
                </span>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                    ENVOYEE_STATUT_STYLES[transaction.statut] ??
                    "bg-foreground-muted/15 text-foreground-muted"
                  }`}
                >
                  {tDashboard.has(`statutShort.${transaction.statut}`)
                    ? tDashboard(`statutShort.${transaction.statut}`)
                    : transaction.statut}
                </span>
              </div>
              <p className="text-xs text-foreground-muted">
                {describeTransactionStatutFan(
                  {
                    statut: transaction.statut,
                    deadlineAcceptation: transaction.deadline_acceptation,
                    deadlineLivraison: transaction.deadline_livraison,
                    confirmationFan: transaction.confirmation_fan,
                    deadlineConfirmation: transaction.deadline_confirmation,
                  },
                  tDashboard,
                  locale,
                )}
              </p>
              {transaction.offreType && (
                <TransactionActions
                  transactionId={transaction.id}
                  type={transaction.offreType}
                  statut={transaction.statut}
                  confirmationFan={transaction.confirmation_fan}
                  expirationDateIso={transaction.expirationDateIso}
                  accesExpire={transaction.accesExpire}
                />
              )}
            </li>
          ))}
          {(envoyees ?? []).length === 0 && (
            <p className="text-sm text-foreground-muted">{t("noHistoriqueEnvoye")}</p>
          )}
        </ul>
      </section>
    </main>
  );
}
