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

  let custom: { fanId?: string; offreId?: string } = {};
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

  // don/campagne have no fixed price -- the fan chooses the amount -- so
  // they're the only types exempt from this check.
  const hasFreeAmount = offerType === "don" || offerType === "campagne";
  if (!hasFreeAmount && Math.abs(amount - Number(offre.prix)) > 0.01) {
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
    reference_cinetpay: transactionId,
  });

  if (insertError) {
    throw new Error(`failed to record transaction: ${insertError.message}`);
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
  }

  return NextResponse.json({ status: "ok" });
}
