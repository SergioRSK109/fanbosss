import { notFound } from "next/navigation";
import { CheckoutButton } from "@/components/CheckoutButton";
import { ReportButton } from "@/components/ReportButton";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function CreateurProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const [{ data: createur }, { data: offres }] = await Promise.all([
    supabase.from("users").select("id, role").eq("id", id).single(),
    supabase
      .from("offres")
      .select("id, type, prix")
      .eq("createur_id", id)
      .eq("actif", true),
  ]);

  if (!createur) {
    notFound();
  }

  const labels: Record<string, string> = {
    video: "Vidéo personnalisée",
    don: "Don libre",
    whatsapp: "Accès WhatsApp premium",
  };

  return (
    <main className="mx-auto max-w-2xl p-6 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Profil créateur</h1>
        <ReportButton createurId={id} />
      </div>

      <ul className="flex flex-col gap-3">
        {(offres ?? []).map((offre) => (
          <li
            key={offre.id}
            className="border rounded px-4 py-3 flex items-center justify-between"
          >
            <span>
              {labels[offre.type]} - {offre.prix}$
            </span>
            <CheckoutButton offreId={offre.id} type={offre.type} />
          </li>
        ))}
        {(offres ?? []).length === 0 && <p>Aucune offre active.</p>}
      </ul>
    </main>
  );
}
