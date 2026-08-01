import { notFound } from "next/navigation";
import { ProduitCheckoutContent } from "@/components/ProduitCheckoutContent";
import { redirect } from "@/i18n/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
    .select("id, type, prix, libelle, actif")
    .eq("id", offreId)
    .single();

  if (!offre || offre.type !== "produit" || !offre.actif) {
    notFound();
  }

  const parsedQuantite = Number(quantiteParam);
  const quantite = Number.isInteger(parsedQuantite) && parsedQuantite > 0 ? parsedQuantite : 1;

  return (
    <ProduitCheckoutContent
      offreId={offre.id}
      libelle={offre.libelle}
      prix={Number(offre.prix)}
      quantite={quantite}
    />
  );
}
