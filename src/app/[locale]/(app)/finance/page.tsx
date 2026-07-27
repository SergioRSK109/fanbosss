import { getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { RetraitRequestForm } from "@/components/RetraitRequestForm";
import { TransactionActions } from "@/components/TransactionActions";
import { formatMontant } from "@/lib/campagnes";
import { describeTransactionStatutFan } from "@/lib/transactions";
import { classifyPaiementRecu } from "@/lib/wallet";
import type { OffreType } from "@/lib/validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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

  const [{ data: soldeRows }, { data: recues }, { data: envoyees }] = await Promise.all([
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
    supabase
      .from("transactions")
      .select(
        "id, montant, statut, deadline_acceptation, deadline_livraison, confirmation_fan, deadline_confirmation, offres(type)",
      )
      .eq("fan_id", user.id)
      .order("created_at", { ascending: false }),
  ]);

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
          {(envoyees ?? []).map((transaction) => {
            const offre = Array.isArray(transaction.offres)
              ? transaction.offres[0]
              : transaction.offres;

            return (
              <li key={transaction.id} className="card flex flex-col gap-2 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">
                    {offre?.type} · {transaction.montant}$
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
                {offre?.type && (
                  <TransactionActions
                    transactionId={transaction.id}
                    type={offre.type as OffreType}
                    statut={transaction.statut}
                    confirmationFan={transaction.confirmation_fan}
                  />
                )}
              </li>
            );
          })}
          {(envoyees ?? []).length === 0 && (
            <p className="text-sm text-foreground-muted">{t("noHistoriqueEnvoye")}</p>
          )}
        </ul>
      </section>
    </main>
  );
}
