import { redirect } from "@/i18n/navigation";
import { DemandesEnAttente } from "@/components/DemandesEnAttente";
import { OffresManager } from "@/components/OffresManager";
import { TransactionActions } from "@/components/TransactionActions";
import type { OffreType } from "@/lib/validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Brief v3 point 1: there is no fan/créateur distinction anymore -- any
// user can both receive payments (offres) and send them to someone else,
// so this single page shows all three, in order: demandes they've
// received, their own offres settings, and payments they've sent to
// others (previously split across /dashboard and /mes-transactions).
const STATUT_LABELS: Record<string, string> = {
  en_attente: "en attente de réponse du créateur",
  validee: "acceptée, en préparation",
  livree: "livrée",
  remboursee: "remboursée",
  refusee: "refusée",
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

  const [{ data: offres }, { data: demandes }, { data: envoyees }] =
    await Promise.all([
      supabase
        .from("offres")
        .select("id, type, prix, libelle, actif, config")
        .eq("createur_id", user.id),
      supabase
        .from("transactions")
        .select("id, montant, deadline_acceptation, offres(type)")
        .eq("createur_id", user.id)
        .eq("statut", "en_attente")
        .order("deadline_acceptation", { ascending: true }),
      supabase
        .from("transactions")
        .select("id, montant, statut, offres(type)")
        .eq("fan_id", user.id)
        .order("created_at", { ascending: false }),
    ]);

  return (
    <main className="mx-auto max-w-2xl p-6 flex flex-col gap-10">
      <h1 className="text-2xl font-semibold">Mon espace FanBoss</h1>

      <section>
        <h2 className="text-lg font-medium mb-3">
          Demandes en attente de votre réponse
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
        <h2 className="text-lg font-medium mb-3">Vos offres</h2>
        <OffresManager
          offres={
            (offres ?? []) as {
              id: string;
              type: OffreType;
              prix: number | null;
              libelle: string | null;
              actif: boolean;
              config: Record<string, unknown>;
            }[]
          }
        />
      </section>

      <section>
        <h2 className="text-lg font-medium mb-3">
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
                className="border rounded px-4 py-3 flex items-center justify-between"
              >
                <span>
                  {offre?.type} - {transaction.montant}$ -{" "}
                  {STATUT_LABELS[transaction.statut] ?? transaction.statut}
                </span>
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
          {(envoyees ?? []).length === 0 && <p>Aucun paiement envoyé.</p>}
        </ul>
      </section>
    </main>
  );
}
