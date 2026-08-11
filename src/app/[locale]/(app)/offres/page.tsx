import { getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { CommandesAExpedier } from "@/components/CommandesAExpedier";
import { ConcoursManager } from "@/components/ConcoursManager";
import { DemandesEnAttente } from "@/components/DemandesEnAttente";
import { LivraisonsEnAttente } from "@/components/LivraisonsEnAttente";
import { OffresManager } from "@/components/OffresManager";
import { OffresTabs } from "@/components/OffresTabs";
import { getConcoursGereesEtInvitations } from "@/lib/concoursPublic";
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
//
// Phase 2 of the produit physique offer type adds a second, nested level
// of tabs on top of that ("Service" / "Produit physique", via
// OffresTabs) -- same pattern as CreateurProfileView's Offres/Publications
// tabs (Lot 5a): both tabs' content is built server-side right here and
// handed to a client component that only toggles visibility. "Service" is
// every offer type that already existed before this lot (its own content
// is unchanged from before -- video/campagne/QUESTION_TYPES never
// included produit, and produit transactions never reach `en_attente` at
// all since the webhook now moves them straight to `validee`, so
// DemandesEnAttente's own query needs no new filter either). "Produit
// physique" is new: no "Demandes en attente" equivalent at all -- there
// is no acceptation step to accept/refuse (see CLAUDE.md's "Physical
// products -- Phase 2" section for why) -- just "Commandes à expédier"
// (validee produit transactions awaiting livrer_produit()) and
// OffresManager filtered to produit only.
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

  const [{ data: offres }, { data: demandes }, { data: profil }, { data: validees }, concoursData] =
    await Promise.all([
      // genere_pour_concours_id is not null for a synthetic campagne
      // migration 0048's creer_concours()/accepter_invitation_concours()
      // auto-create -- excluded here so it never appears in the
      // créateur's own offer-management list, exactly per Part A.4.
      supabase
        .from("offres")
        .select("id, type, prix, libelle, actif, config, stock_total, image_r2_key")
        .eq("createur_id", user.id)
        .is("genere_pour_concours_id", null),
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
      // own comment). Since Phase 2 (migration 0040 + the webhook change
      // it required), a produit transaction ALSO reaches `validee` --
      // awaiting shipment, not a file -- so this same query is now split
      // in JS below into the Service tab's `livraisons` (video/shoutout)
      // and the Produit physique tab's `commandes` (produit), rather than
      // querying twice.
      supabase
        .from("transactions")
        .select("id, montant, quantite, deadline_livraison, adresse_livraison, offres(type, libelle)")
        .eq("createur_id", user.id)
        .eq("statut", "validee")
        .order("deadline_livraison", { ascending: true }),
      // Phase 1-bis: concours the créateur organizes/has accepted, plus
      // invitations still awaiting a decision -- see
      // getConcoursGereesEtInvitations()'s own comment for why this
      // reads concours_participants (self-only, migration 0046) then
      // concours_publics, never a new table policy on `concours` itself.
      getConcoursGereesEtInvitations(user.id),
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

  const valideesNormalisees = (validees ?? []).map((validee) => ({
    ...validee,
    offres: Array.isArray(validee.offres) ? validee.offres[0] : validee.offres,
  })) as {
    id: string;
    montant: number;
    quantite: number;
    deadline_livraison: string | null;
    adresse_livraison: string | null;
    offres: { type: OffreType; libelle: string | null } | null;
  }[];

  const livraisonsService = valideesNormalisees.filter(
    (validee) => validee.offres?.type !== "produit",
  );
  const commandesProduit = valideesNormalisees.filter(
    (validee) => validee.offres?.type === "produit",
  );

  const offresNormalisees = (
    (offres ?? []) as {
      id: string;
      type: OffreType;
      prix: number | null;
      libelle: string | null;
      actif: boolean;
      config: Record<string, unknown>;
      stock_total: number | null;
      image_r2_key: string | null;
    }[]
  ).map((offre) => ({
    ...offre,
    montantCollecte:
      offre.type === "campagne" ? montantCollecteParOffre.get(offre.id) ?? 0 : undefined,
  }));

  const serviceContent = (
    <div className="flex flex-col gap-8">
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
        <LivraisonsEnAttente livraisons={livraisonsService} />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">{t("offresHeading")}</h2>
        <OffresManager offres={offresNormalisees} mode="service" />
      </section>
    </div>
  );

  const produitContent = (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="mb-3 text-lg font-bold">{t("commandesHeading")}</h2>
        <p className="mb-3 text-sm text-foreground-muted">{t("commandes.intro")}</p>
        <CommandesAExpedier commandes={commandesProduit} />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">{t("offresHeading")}</h2>
        <OffresManager offres={offresNormalisees} mode="produit" />
      </section>
    </div>
  );

  // Migration 0048: creer_concours()/accepter_invitation_concours() both
  // create and own their own synthetic campagne automatically, so
  // ConcoursManager no longer needs the créateur's own campagnes threaded
  // in at all -- see CLAUDE.md's "Creator contests -- campagne
  // auto-générée" section.
  const concoursContent = (
    <ConcoursManager
      viewerId={user.id}
      mesConcours={concoursData.mesConcours}
      invitations={concoursData.invitations}
    />
  );

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 p-5 sm:p-6">
      <h1 className="text-2xl font-bold">{tOffres("heading")}</h1>
      <OffresTabs
        serviceContent={serviceContent}
        produitContent={produitContent}
        concoursContent={concoursContent}
      />
    </main>
  );
}
