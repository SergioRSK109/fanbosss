import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ProduitCheckoutContent } from "@/components/ProduitCheckoutContent";
import { redirect } from "@/i18n/navigation";
import { checkDeliveryZone, type PorteeLivraison } from "@/lib/livraison";
import {
  createSupabaseServerClient,
  createSupabaseServiceRoleClient,
} from "@/lib/supabase/server";

// Phase 3 of the "produit physique" offer type: the fan-facing
// verification/reservation page ProduitCard's own "Commander" button
// links to (/paiement/produit/[offreId]?quantite=N). Reserving stock
// requires a real account (reserver_stock_produit() itself rejects a
// NULL auth.uid()), so this page redirects a logged-out visitor to
// /login the same way every other authenticated page in this app
// already does -- there is no meaningful "browse this page while logged
// out" state to preserve here, unlike /home or a public profile.
export default async function PaiementProduitPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; offreId: string }>;
  searchParams: Promise<{ quantite?: string }>;
}) {
  const { locale, offreId } = await params;
  const { quantite: quantiteParam } = await searchParams;
  const t = await getTranslations({ locale, namespace: "PaiementProduit" });

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect({ href: "/login", locale });
    return;
  }

  // Read through the public view (never the raw table) -- this is a fan
  // reading someone else's offer, same reasoning as
  // /api/transactions/initiate.
  const { data: offre } = await supabase
    .from("offres_publiques")
    .select("id, createur_id, type, prix, libelle, actif")
    .eq("id", offreId)
    .single();

  if (!offre || offre.type !== "produit" || !offre.actif) {
    notFound();
  }

  const parsedQuantite = Number(quantiteParam);
  const quantite = Number.isInteger(parsedQuantite) && parsedQuantite > 0 ? parsedQuantite : 1;

  // Delivery-zone restriction (migration 0055), checked here -- before
  // this page ever renders the reservation UI at all, i.e. strictly
  // before reserver_stock_produit() could ever be called -- rather than
  // inside ProduitCheckoutContent's own mount effect. A blocked fan never
  // sees a "reserving..." state that was always going to fail.
  //
  // The fan's own province/pays comes straight from the authenticated
  // client (users_select_self RLS -- a fan reading their own row). The
  // créateur's portee_livraison/province/pays isn't exposed by
  // profils_publics at all (neither is portee_livraison itself, and
  // adding province there for this one feature would make it public to
  // every visitor, not just a fan already mid-checkout) -- read via the
  // service-role client instead, same "authenticated route bypasses RLS
  // for a specific, already-authorized read" pattern already established
  // for whatsapp-link/content-url/live-link.
  const [{ data: fanProfil }, { data: createurProfil }] = await Promise.all([
    supabase.from("users").select("province, pays").eq("id", user.id).single(),
    createSupabaseServiceRoleClient()
      .from("users")
      .select("portee_livraison, province, pays")
      .eq("id", offre.createur_id)
      .single(),
  ]);

  const portee = (createurProfil?.portee_livraison as PorteeLivraison | undefined) ?? null;
  const fanValue = portee === "province" ? fanProfil?.province : fanProfil?.pays;
  const createurValue = portee === "province" ? createurProfil?.province : createurProfil?.pays;
  const zoneCheck = checkDeliveryZone(portee, fanValue ?? null, createurValue ?? null);

  if (zoneCheck.blocked) {
    return (
      <main className="mx-auto flex min-h-[70dvh] max-w-sm flex-col justify-center gap-4 px-5 py-10 text-center">
        <div className="card flex flex-col gap-3 p-5">
          <h1 className="text-xl font-bold">{t("zoneBloqueeTitre")}</h1>
          <p className="text-sm text-foreground-muted">
            {portee === "province" ? t("zoneBloqueeProvince") : t("zoneBloqueePays")}
          </p>
        </div>
      </main>
    );
  }

  return (
    <ProduitCheckoutContent
      offreId={offre.id}
      libelle={offre.libelle}
      prix={Number(offre.prix)}
      quantite={quantite}
      avertissementZoneLivraison={zoneCheck.missingFanData}
    />
  );
}
