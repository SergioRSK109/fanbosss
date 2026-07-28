import { getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { DemandesEnAttente } from "@/components/DemandesEnAttente";
import { LivraisonsEnAttente } from "@/components/LivraisonsEnAttente";
import { OffresManager } from "@/components/OffresManager";
import type { OffreType } from "@/lib/validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Lot 3: the "Offres" tab -- demandes en attente à traiter + configuration
// des offres, extracted verbatim (same components, same queries) from what
// used to be the second half of /dashboard. Still reads from the
// "Dashboard" i18n namespace for these sections' own headings
// (demandesHeading/nouvellesDemandes/offresHeading) rather than a new
// "Offres" namespace -- renaming a namespace that's not itself
// user-visible would be a much wider change than this lot needs, same
// call already made for the Finance/finance split in Lot 2b.

export default async function OffresPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Dashboard" });
  const tOffres = await getTranslations({ locale, namespace: "OffresPage" });
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect({ href: "/login", locale });
    return;
  }

  const [{ data: offres }, { data: demandes }, { data: profil }, { data: livraisons }] =
    await Promise.all([
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
      supabase.from("users").select("dernier_vu_demandes_at").eq("id", user.id).single(),
      // Security audit fix: accepted (validee) video/shoutout
      // transactions still awaiting the créateur's own file upload --
      // this list never existed before (see LivraisonsEnAttente.tsx's
      // own comment). In practice only video/shoutout transactions ever
      // sit at `validee` at all (every other type either cascades
      // straight through to livree or skips validee entirely -- see
      // CLAUDE.md's "Transaction lifecycle"), so no extra offer-type
      // filter is needed here, same reasoning DemandesEnAttente's own
      // query already relies on for `en_attente`.
      supabase
        .from("transactions")
        .select("id, montant, deadline_livraison, offres(type, libelle)")
        .eq("createur_id", user.id)
        .eq("statut", "validee")
        .order("deadline_livraison", { ascending: true }),
    ]);

  // Montant collecté per campagne, computed live via
  // campagnes_montant_collecte (migration 0017) -- same view the public
  // profile reads, so this page's numbers can never disagree with what a
  // fan sees. Only fetched when the créateur actually has a campagne
  // offre.
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
    <main className="mx-auto flex max-w-2xl flex-col gap-8 p-5 sm:p-6">
      <h1 className="text-2xl font-bold">{tOffres("heading")}</h1>

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
          {t("demandesHeading")}
          {nouvellesDemandes > 0 && (
            <span className="rounded-full bg-accent-500 px-2 py-0.5 text-xs font-bold text-white">
              {t("nouvellesDemandes", { count: nouvellesDemandes })}
            </span>
          )}
        </h2>
        <DemandesEnAttente
          demandes={
            (demandes ?? []).map((demande) => ({
              ...demande,
              offres: Array.isArray(demande.offres) ? demande.offres[0] : demande.offres,
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
        <h2 className="mb-3 text-lg font-bold">{t("livraisonsHeading")}</h2>
        <p className="mb-3 text-sm text-foreground-muted">{t("livraisons.intro")}</p>
        <LivraisonsEnAttente
          livraisons={
            (livraisons ?? []).map((livraison) => ({
              ...livraison,
              offres: Array.isArray(livraison.offres) ? livraison.offres[0] : livraison.offres,
            })) as {
              id: string;
              montant: number;
              deadline_livraison: string | null;
              offres: { type: OffreType; libelle: string | null } | null;
            }[]
          }
        />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">{t("offresHeading")}</h2>
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
    </main>
  );
}
