import { useTranslations } from "next-intl";
import { notFound } from "next/navigation";
import { CheckoutButton } from "@/components/CheckoutButton";
import { ReportButton } from "@/components/ReportButton";
import type { OffreType } from "@/lib/validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Public browsing goes through profils_publics / offres_publiques, not the
// raw `users`/`offres` tables -- those views intentionally omit
// `telephone` and `config` so a visitor querying Supabase directly (not
// through this page) can't read them either. See migration 0006.
export default async function CreateurProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const [{ data: createur }, { data: offres }] = await Promise.all([
    supabase.from("profils_publics").select("id").eq("id", id).single(),
    supabase
      .from("offres_publiques")
      .select("id, type, prix, libelle")
      .eq("createur_id", id),
  ]);

  if (!createur) {
    notFound();
  }

  return (
    <CreateurProfileView
      createurId={id}
      offres={offres ?? []}
    />
  );
}

function CreateurProfileView({
  createurId,
  offres,
}: {
  createurId: string;
  offres: {
    id: string;
    type: OffreType;
    prix: number | null;
    libelle: string | null;
  }[];
}) {
  const t = useTranslations("CreateurProfile");
  const labels: Record<string, string> = {
    video: t("offerTypes.video"),
    don: t("offerTypes.don"),
    whatsapp: t("offerTypes.whatsapp"),
    shoutout: t("offerTypes.shoutout"),
    contenu_debloque: t("offerTypes.contenu_debloque"),
    evenement_live: t("offerTypes.evenement_live"),
  };

  return (
    <main className="mx-auto max-w-2xl p-6 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("heading")}</h1>
        <ReportButton createurId={createurId} />
      </div>

      <ul className="flex flex-col gap-3">
        {offres.map((offre) => (
          <li
            key={offre.id}
            className="border rounded px-4 py-3 flex items-center justify-between"
          >
            <span>
              {labels[offre.type] ?? offre.type}
              {offre.libelle && ` (${offre.libelle})`}
              {offre.prix !== null && ` - ${offre.prix}$`}
            </span>
            <CheckoutButton offreId={offre.id} type={offre.type} />
          </li>
        ))}
        {offres.length === 0 && <p>{t("noActiveOffers")}</p>}
      </ul>
    </main>
  );
}
