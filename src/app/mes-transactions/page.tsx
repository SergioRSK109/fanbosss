import { redirect } from "next/navigation";
import { TransactionActions } from "@/components/TransactionActions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const STATUT_LABELS: Record<string, string> = {
  en_attente: "en attente de réponse du créateur",
  validee: "acceptée, en préparation",
  livree: "livrée",
  remboursee: "remboursée",
  refusee: "refusée",
};

export default async function MesTransactionsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: transactions } = await supabase
    .from("transactions")
    .select("id, montant, statut, offres(type)")
    .eq("fan_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold mb-6">Mes transactions</h1>
      <ul className="flex flex-col gap-3">
        {(transactions ?? []).map((transaction) => {
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
        {(transactions ?? []).length === 0 && <p>Aucune transaction.</p>}
      </ul>
    </main>
  );
}
