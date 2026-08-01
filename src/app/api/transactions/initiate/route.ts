import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { initiateCinetPayPayment } from "@/lib/cinetpay";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Creates no transaction row: per the brief's lifecycle (section 4.2), a
// transaction only exists once CinetPay confirms payment, via the webhook.
// This route just starts checkout and hands CinetPay enough context
// (cpm_custom) to let the webhook create that row later.
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const offreId = String(body.offreId ?? "");
  if (!offreId) {
    return NextResponse.json({ error: "offreId is required" }, { status: 400 });
  }

  // Reads through the public view (id/type/prix/actif/createur_id only,
  // never `config`) rather than the raw table, since this is a fan
  // reading someone else's offer -- see migration 0006.
  const { data: offre, error } = await supabase
    .from("offres_publiques")
    .select("id, type, prix, actif, createur_id")
    .eq("id", offreId)
    .single();

  if (error || !offre || !offre.actif) {
    return NextResponse.json({ error: "offre introuvable" }, { status: 404 });
  }

  // produit only, phase 1 of the "produit physique" offer type: quantite
  // and reservationId are only relevant/required for this type -- both
  // are ignored for every other offer. reservationId is re-verified
  // against the CALLING fan's own row (reservations_stock's RLS policy
  // reservations_stock_select_own already scopes this select to
  // fan_id = auth.uid(), so there's no way to forge another fan's
  // reservation id here even before the explicit checks below).
  //
  // Phase 3: adresseLivraison is required alongside quantite/reservationId
  // for this same type -- a physical shipment needs somewhere to go, and
  // this is the only checkout path that ever collects it (there's no
  // separate "add your address" step anywhere else in this flow).
  let quantite = 1;
  let adresseLivraison: string | null = null;
  if (offre.type === "produit") {
    quantite = Number(body.quantite);
    if (!Number.isInteger(quantite) || quantite <= 0) {
      return NextResponse.json({ error: "quantité invalide" }, { status: 400 });
    }

    const reservationId = String(body.reservationId ?? "");
    if (!reservationId) {
      return NextResponse.json(
        { error: "reservationId is required for a produit offer" },
        { status: 400 },
      );
    }

    adresseLivraison = String(body.adresseLivraison ?? "").trim();
    if (!adresseLivraison) {
      return NextResponse.json(
        { error: "adresseLivraison is required for a produit offer" },
        { status: 400 },
      );
    }

    const { data: reservation, error: reservationError } = await supabase
      .from("reservations_stock")
      .select("id, offre_id, quantite, expire_at, transaction_id")
      .eq("id", reservationId)
      .single();

    if (
      reservationError ||
      !reservation ||
      reservation.offre_id !== offre.id ||
      reservation.transaction_id !== null ||
      new Date(reservation.expire_at).getTime() <= Date.now() ||
      reservation.quantite !== quantite
    ) {
      return NextResponse.json(
        { error: "réservation introuvable ou expirée" },
        { status: 400 },
      );
    }
  }

  let montant: number;
  if (offre.type === "don" || offre.type === "campagne") {
    montant = Number(body.montant);
    if (!Number.isFinite(montant) || montant <= 0) {
      return NextResponse.json(
        { error: "montant invalide" },
        { status: 400 },
      );
    }
  } else if (offre.type === "produit") {
    montant = Number(offre.prix) * quantite;
  } else {
    montant = Number(offre.prix);
  }

  const transactionId = randomUUID();

  const custom: Record<string, unknown> = { fanId: user.id, offreId: offre.id };
  if (offre.type === "produit") {
    custom.quantite = quantite;
    custom.reservationId = String(body.reservationId);
    custom.adresseLivraison = adresseLivraison;
  }

  const paymentUrl = await initiateCinetPayPayment({
    transactionId,
    amount: montant,
    description: `FanBoss - offre ${offre.type}`,
    customerId: user.id,
    custom,
  });

  return NextResponse.json({ transactionId, paymentUrl });
}
