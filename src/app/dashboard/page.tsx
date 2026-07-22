import { redirect } from "next/navigation";
import { DemandesEnAttente } from "@/components/DemandesEnAttente";
import { OffresManager } from "@/components/OffresManager";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role === "fan") {
    redirect("/mes-transactions");
  }

  const [{ data: offres }, { data: demandes }] = await Promise.all([
    supabase
      .from("offres")
      .select("id, type, prix, actif")
      .eq("createur_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("transactions")
      .select("id, montant, deadline_acceptation, offres(type)")
      .eq("createur_id", user.id)
      .eq("statut", "en_attente")
      .order("deadline_acceptation", { ascending: true }),
  ]);

  return (
    <main className="mx-auto max-w-2xl p-6 flex flex-col gap-10">
      <h1 className="text-2xl font-semibold">Mon espace créateur</h1>

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
              offres: { type: "video" | "don" | "whatsapp" } | null;
            }[]
          }
        />
      </section>

      <section>
        <h2 className="text-lg font-medium mb-3">Mes offres</h2>
        <OffresManager offres={offres ?? []} />
      </section>
    </main>
  );
}
