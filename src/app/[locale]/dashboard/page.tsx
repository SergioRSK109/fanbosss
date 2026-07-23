import { redirect, Link } from "@/i18n/navigation";
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

  const [
    { data: offres },
    { data: demandes },
    { data: envoyees },
    { data: profil },
    { data: volumeRow },
    { data: reactiviteRow },
    { data: progressionRow },
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
      .select("id, montant, statut, offres(type)")
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
  ]);

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
    <main className="mx-auto max-w-2xl p-6 flex flex-col gap-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Mon espace FanBoss</h1>
        <Link href="/parametres" className="text-sm underline">
          Réglages
        </Link>
      </div>

      <p className="text-sm text-gray-500">
        Votre profil public :{" "}
        {profil?.pseudo ? (
          <Link href={`/@${profil.pseudo}`} className="underline">
            fanboss.app/@{profil.pseudo}
          </Link>
        ) : (
          <>
            pas encore de pseudo --{" "}
            <Link href="/parametres" className="underline">
              en choisir un
            </Link>
          </>
        )}
      </p>

      {profil?.classement_public && (
        <div className="flex flex-wrap gap-2">
          {volumeRow && (
            <span className="text-sm border rounded-full px-3 py-1">
              🏆 #{volumeRow.rang} volume (30j)
            </span>
          )}
          {reactiviteRow && (
            <span className="text-sm border rounded-full px-3 py-1">
              ⚡ #{reactiviteRow.rang} réactivité (30j)
            </span>
          )}
          {progressionRow && (
            <span className="text-sm border rounded-full px-3 py-1">
              📈 #{progressionRow.rang} progression (30j)
            </span>
          )}
        </div>
      )}

      <section>
        <h2 className="text-lg font-medium mb-3 flex items-center gap-2">
          Demandes en attente de votre réponse
          {nouvellesDemandes > 0 && (
            <span className="bg-red-600 text-white text-xs rounded-full px-2 py-0.5">
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
