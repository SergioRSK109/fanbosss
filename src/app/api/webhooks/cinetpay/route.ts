import { NextRequest, NextResponse } from "next/server";
import { verifyCinetPaySignature } from "@/lib/cinetpay";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import type { OffreType } from "@/lib/validation";

// Types with no acceptation step: payment success IS delivery. Brief v3
// point 2 adds contenu_debloque (pre-uploaded content, unlocked on
// payment) and evenement_live (external link revealed on payment) to the
// original don-only set. campagne is the same free-amount mechanic as
// don (see the fundraising-campaigns feature).
const TYPES_A_VALIDATION_IMMEDIATE: OffreType[] = [
  "don",
  "contenu_debloque",
  "evenement_live",
  "campagne",
];

// CinetPay POSTs notifications as application/x-www-form-urlencoded.
async function parseNotificationBody(
  request: NextRequest,
): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return (await request.json()) as Record<string, unknown>;
  }

  const formData = await request.formData();
  return Object.fromEntries(formData.entries());
}

export async function POST(request: NextRequest) {
  const notification = await parseNotificationBody(request);
  const receivedToken = request.headers.get("x-token");

  // Brief 0.1: fail closed, unconditionally. No signature, no dev
  // trust-by-default, no exceptions.
  const isValid = verifyCinetPaySignature(
    notification,
    receivedToken,
    process.env.CINETPAY_SECRET_KEY,
  );

  if (!isValid) {
    return NextResponse.json(
      { error: "invalid or missing webhook signature" },
      { status: 403 },
    );
  }

  const transactionId = String(notification.cpm_trans_id ?? "");
  const transStatus = String(notification.cpm_trans_status ?? "").toUpperCase();
  const amount = Number(notification.cpm_amount);

  if (!transactionId) {
    return NextResponse.json(
      { error: "cpm_trans_id missing from notification" },
      { status: 400 },
    );
  }

  if (transStatus !== "ACCEPTED") {
    // Payment failed/cancelled: no transaction row was ever created for it,
    // there is nothing to reconcile.
    return NextResponse.json({ status: "ignored", reason: transStatus });
  }

  let custom: {
    fanId?: string;
    offreId?: string;
    quantite?: number;
    reservationId?: string;
  } = {};
  try {
    custom = JSON.parse(String(notification.cpm_custom ?? "{}"));
  } catch {
    return NextResponse.json(
      { error: "cpm_custom is not valid JSON" },
      { status: 400 },
    );
  }

  if (!custom.fanId || !custom.offreId) {
    return NextResponse.json(
      { error: "cpm_custom missing fanId/offreId" },
      { status: 400 },
    );
  }

  const supabase = createSupabaseServiceRoleClient();

  // Idempotency: CinetPay may resend a notification. transactionId doubles
  // as the transactions primary key, so a repeat delivery just no-ops.
  const { data: existing } = await supabase
    .from("transactions")
    .select("id")
    .eq("id", transactionId)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ status: "already_processed" });
  }

  // Brief 0.4: explicitly fetch the offer type via a real query before any
  // conditional logic. A field that was never fetched must never be
  // silently treated as falsy/undefined and fall into a default branch.
  const { data: offre, error: offreError } = await supabase
    .from("offres")
    .select("id, type, createur_id, prix")
    .eq("id", custom.offreId)
    .single();

  if (offreError || !offre) {
    return NextResponse.json({ error: "offre introuvable" }, { status: 400 });
  }

  const offerType = offre.type as OffreType;
  if (!offerType) {
    throw new Error(
      `offer type could not be determined for offre ${custom.offreId}`,
    );
  }

  // Phase 1 of the "produit physique" offer type: a unit price times a
  // quantity, not a fixed prix alone -- read/validated before the
  // montant check below, which needs it. reservationId was already
  // verified against the calling fan's own row at /api/transactions/
  // initiate (section 4); re-parsed here from the same HMAC-verified
  // cpm_custom payload every other field in this webhook is already
  // trusted from.
  let quantite = 1;
  if (offerType === "produit") {
    quantite = Number(custom.quantite);
    if (!Number.isInteger(quantite) || quantite <= 0 || !custom.reservationId) {
      return NextResponse.json(
        { error: "cpm_custom missing/invalid quantite or reservationId for a produit offer" },
        { status: 400 },
      );
    }
  }

  // don/campagne have no fixed price -- the fan chooses the amount.
  // produit has a fixed per-unit price, but the total owed is prix ×
  // quantite, not prix alone -- both are checked against the real amount
  // CinetPay actually confirmed, never trusted from the client.
  const hasFreeAmount = offerType === "don" || offerType === "campagne";
  const expectedAmount = offerType === "produit" ? Number(offre.prix) * quantite : Number(offre.prix);
  if (!hasFreeAmount && Math.abs(amount - expectedAmount) > 0.01) {
    return NextResponse.json(
      { error: "montant payé ne correspond pas au prix de l'offre" },
      { status: 400 },
    );
  }

  const { error: insertError } = await supabase.from("transactions").insert({
    id: transactionId,
    fan_id: custom.fanId,
    createur_id: offre.createur_id,
    offre_id: offre.id,
    montant: amount,
    quantite,
    reference_cinetpay: transactionId,
  });

  if (insertError) {
    throw new Error(`failed to record transaction: ${insertError.message}`);
  }

  // Phase 1 of the "produit physique" offer type: mark the reservation
  // permanent (this is what makes it count in disponible_definitif
  // rather than disponible_maintenant only -- see
  // offres_disponibilite_produit, migration 0039), then close the offer
  // the instant it's genuinely sold out. Both are essential bookkeeping,
  // not an optional side effect like the notification below -- unlike
  // that call, a failure here throws, matching this file's own existing
  // precedent for insertError/validateError/deliverError just above and
  // below.
  //
  // Scoped to the exact reservation this fan/offre pair already
  // established at /api/transactions/initiate -- .is("transaction_id",
  // null) guards against ever double-confirming the same reservation on
  // a resent webhook (though the idempotency check at the top of this
  // route already short-circuits a genuine resend before reaching here).
  //
  // A rare, accepted risk, not a bug to fix here (per the brief's own
  // explicit instruction, section 0): if this reservation's 10-minute
  // hold had already expired before payment confirmed, another fan may
  // have concurrently reserved and confirmed the same unit in the
  // meantime -- an oversell. There is no new automatic-refund mechanism
  // in this lot; the oversold fan lands in the existing manual-refund
  // queue the same way any other manual case does, once a créateur or
  // admin notices the offer can't actually be fulfilled.
  if (offerType === "produit" && custom.reservationId) {
    const { error: reservationError } = await supabase
      .from("reservations_stock")
      .update({ transaction_id: transactionId })
      .eq("id", custom.reservationId)
      .eq("offre_id", offre.id)
      .eq("fan_id", custom.fanId)
      .is("transaction_id", null);

    if (reservationError) {
      throw new Error(`failed to confirm stock reservation: ${reservationError.message}`);
    }

    const { data: disponibilite, error: disponibiliteError } = await supabase
      .from("offres_disponibilite_produit")
      .select("disponible_definitif")
      .eq("offre_id", offre.id)
      .single();

    if (disponibiliteError) {
      throw new Error(`failed to recompute stock availability: ${disponibiliteError.message}`);
    }

    if ((disponibilite?.disponible_definitif ?? 0) <= 0) {
      const { error: closeError } = await supabase
        .from("offres")
        .update({ actif: false })
        .eq("id", offre.id);

      if (closeError) {
        throw new Error(`failed to close sold-out offre: ${closeError.message}`);
      }
    }
  }

  // Lot 6a: tells the créateur a new transaction landed. video/shoutout/
  // whatsapp (has an acceptation step -- not in TYPES_A_VALIDATION_IMMEDIATE)
  // gets 'demande_recue' (there's something for them to do); don/campagne
  // get 'don_recu' (a contribution, no action needed). contenu_debloque/
  // evenement_live are deliberately silent here -- neither "a request" nor
  // "a don" describes a pre-configured purchase, and the notifications
  // `type` CHECK constraint has no third label for it; flagged rather than
  // forcing one of the two existing types onto an event they don't
  // describe. Never allowed to fail the webhook itself -- the transaction
  // is already safely recorded, a missed bell notification is not worth
  // turning a successful payment into a 500 CinetPay might retry.
  const notificationType = !TYPES_A_VALIDATION_IMMEDIATE.includes(offerType)
    ? "demande_recue"
    : offerType === "don" || offerType === "campagne"
      ? "don_recu"
      : null;

  if (notificationType) {
    const { error: notificationError } = await supabase.rpc("creer_notification", {
      p_destinataire_id: offre.createur_id,
      p_type: notificationType,
      p_transaction_id: transactionId,
      p_acteur_id: custom.fanId,
    });
    if (notificationError) {
      console.error("failed to create notification:", notificationError.message);
    }
  }

  // Confirmed via the explicit join above, never via an undefined fallback:
  // these types have no acceptation/livraison step, so payment success IS
  // delivery.
  if (TYPES_A_VALIDATION_IMMEDIATE.includes(offerType)) {
    const { error: validateError } = await supabase
      .from("transactions")
      .update({ statut: "validee" })
      .eq("id", transactionId);

    if (validateError) {
      throw new Error(`failed to validate transaction: ${validateError.message}`);
    }

    const { error: deliverError } = await supabase
      .from("transactions")
      .update({ statut: "livree" })
      .eq("id", transactionId);

    if (deliverError) {
      throw new Error(`failed to deliver transaction: ${deliverError.message}`);
    }
  } else if (offerType === "produit") {
    // Phase 2 revision of Phase 1's original design (see CLAUDE.md): a
    // produit transaction skips the accept/refuse step entirely -- a
    // créateur listing a fixed-price, fixed-stock product has nothing to
    // individually approve per order the way a custom video request
    // might. It still isn't immediate delivery either (unlike
    // TYPES_A_VALIDATION_IMMEDIATE above) -- the créateur still has to
    // ship it, via livrer_produit() (migration 0040) -- so this is only
    // the first of those two steps, never the second.
    const { error: validateError } = await supabase
      .from("transactions")
      .update({ statut: "validee" })
      .eq("id", transactionId);

    if (validateError) {
      throw new Error(`failed to validate produit transaction: ${validateError.message}`);
    }
  }

  return NextResponse.json({ status: "ok" });
}
