import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Phase 3 of the "produit physique" offer type: thin RPC wrapper around
// reserver_stock_produit() (migration 0039), same shape as every other
// RPC wrapper in this project -- the real rejection logic (auth, offre
// type/actif, quantity vs. real availability, the row-lock serialization
// itself) lives entirely in the database function, verified empirically
// there (see CLAUDE.md's Phase 1 section). This route just surfaces
// whatever it returns.
//
// On a rejection, also returns the offre's current
// offres_disponibilite_produit row so the caller (the checkout page's
// client component) can render the right one of the two failure states
// (réservé temporairement vs. épuisé) without a second round trip.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const quantite = Number(body.quantite);

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  if (!Number.isInteger(quantite) || quantite <= 0) {
    return NextResponse.json({ error: "quantité invalide" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("reserver_stock_produit", {
    p_offre_id: id,
    p_quantite: quantite,
  });

  if (error) {
    const { data: disponibilite } = await supabase
      .from("offres_disponibilite_produit")
      .select("disponible_maintenant, disponible_definitif, prochaine_liberation")
      .eq("offre_id", id)
      .maybeSingle();

    return NextResponse.json(
      {
        error: error.message,
        disponibleMaintenant: disponibilite?.disponible_maintenant ?? 0,
        disponibleDefinitif: disponibilite?.disponible_definitif ?? 0,
        prochaineLiberation: disponibilite?.prochaine_liberation ?? null,
      },
      { status: 400 },
    );
  }

  const reservation = Array.isArray(data) ? data[0] : data;

  return NextResponse.json({
    reservationId: reservation.reservation_id,
    expireAt: reservation.expire_at,
  });
}
