import { NextRequest, NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  createSupabaseServiceRoleClient,
} from "@/lib/supabase/server";

// evenement_live: the créateur streams externally (YouTube/Zoom/
// Instagram...) and just sets offres.config.lien_live -- payment reveals
// that link. Same guardrails as whatsapp-link/video-url: fan_id =
// auth.uid() AND statut = 'livree', re-verified on every call. The link
// isn't copied into the transaction at payment time, so it always reflects
// whatever the créateur has it set to right now.
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
    .select("id, fan_id, statut, offre_id")
    .eq("id", id)
    .single();

  if (error || !transaction) {
    return NextResponse.json({ error: "transaction introuvable" }, { status: 404 });
  }

  if (transaction.fan_id !== user.id) {
    return NextResponse.json({ error: "not authorized" }, { status: 403 });
  }

  if (transaction.statut !== "livree") {
    return NextResponse.json(
      { error: "le lien n'a pas encore été révélé" },
      { status: 403 },
    );
  }

  // Reads offre.config, not exposed by the public offres_publiques view --
  // authorization was already re-verified above, same pattern as
  // whatsapp-link/content-url.
  const serviceClient = createSupabaseServiceRoleClient();
  const { data: offre } = await serviceClient
    .from("offres")
    .select("type, config")
    .eq("id", transaction.offre_id)
    .single();

  if (offre?.type !== "evenement_live") {
    return NextResponse.json({ error: "offre non applicable" }, { status: 400 });
  }

  const lienLive = (offre.config as { lien_live?: string } | null)?.lien_live;
  if (!lienLive) {
    return NextResponse.json(
      { error: "aucun lien associé à cette offre" },
      { status: 404 },
    );
  }

  return NextResponse.json({ lienLive });
}
