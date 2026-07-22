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

  let montant: number;
  if (offre.type === "don") {
    montant = Number(body.montant);
    if (!Number.isFinite(montant) || montant <= 0) {
      return NextResponse.json(
        { error: "montant invalide pour un don" },
        { status: 400 },
      );
    }
  } else {
    montant = Number(offre.prix);
  }

  const transactionId = randomUUID();

  const paymentUrl = await initiateCinetPayPayment({
    transactionId,
    amount: montant,
    description: `FanBoss - offre ${offre.type}`,
    customerId: user.id,
    custom: { fanId: user.id, offreId: offre.id },
  });

  return NextResponse.json({ transactionId, paymentUrl });
}
