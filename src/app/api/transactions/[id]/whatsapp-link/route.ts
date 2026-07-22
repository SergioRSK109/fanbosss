import { NextRequest, NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  createSupabaseServiceRoleClient,
} from "@/lib/supabase/server";

// Brief 4.3: the créateur's number is revealed only after they've validated
// THIS specific transaction (opt-in per transaction, not per profile), and
// only ever as a standard wa.me link -- never through the WhatsApp Business
// API. This route is the pattern brief 0.5 asks the video delivery route to
// copy: verify fan_id = auth.uid() AND statut = 'livree' before returning
// anything.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const { data: transaction, error } = await supabase
    .from("transactions")
    .select("id, fan_id, statut, createur_id, offres(type)")
    .eq("id", id)
    .single();

  if (error || !transaction) {
    return NextResponse.json({ error: "transaction introuvable" }, { status: 404 });
  }

  const offre = Array.isArray(transaction.offres)
    ? transaction.offres[0]
    : transaction.offres;

  if (transaction.fan_id !== user.id) {
    return NextResponse.json({ error: "not authorized" }, { status: 403 });
  }

  if (offre?.type !== "whatsapp") {
    return NextResponse.json({ error: "offre non applicable" }, { status: 400 });
  }

  if (transaction.statut !== "livree") {
    return NextResponse.json(
      { error: "le créateur n'a pas encore validé la demande" },
      { status: 403 },
    );
  }

  // Reads another user's telephone -- only reachable here because
  // fan_id/statut were already re-verified above. Since migration 0006,
  // `users` has no broad public SELECT policy (it previously matched
  // "role in ('createur','both')", which is almost every account, and
  // exposed telephone to any authenticated caller who queried the table
  // directly rather than going through this route), so this now needs the
  // service-role client, same as the webhook/cron paths.
  const serviceClient = createSupabaseServiceRoleClient();
  const { data: createur } = await serviceClient
    .from("users")
    .select("telephone")
    .eq("id", transaction.createur_id)
    .single();

  if (!createur?.telephone) {
    return NextResponse.json(
      { error: "numéro non disponible" },
      { status: 404 },
    );
  }

  const message = encodeURIComponent(
    "Bonjour ! Je vous contacte suite à mon accès WhatsApp premium sur FanBoss.",
  );
  const numero = createur.telephone.replace(/[^\d]/g, "");

  return NextResponse.json({
    waLink: `https://wa.me/${numero}?text=${message}`,
  });
}
