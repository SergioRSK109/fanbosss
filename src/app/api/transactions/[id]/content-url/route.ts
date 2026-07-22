import { NextRequest, NextResponse } from "next/server";
import { getSignedDownloadUrl } from "@/lib/r2";
import {
  createSupabaseServerClient,
  createSupabaseServiceRoleClient,
} from "@/lib/supabase/server";

// contenu_debloque delivery: the file lives on the OFFER (config.r2_key,
// uploaded once), not on the transaction -- every paying fan unlocks the
// same pre-uploaded content. Same guardrails as video-url (brief 0.5):
// fan_id = auth.uid() AND statut = 'livree', re-verified on every call,
// before a short-lived signed URL is minted. Never a public bucket URL.
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
      { error: "le contenu n'a pas encore été débloqué" },
      { status: 403 },
    );
  }

  // Reads offre.config, which is not exposed by the public offres_publiques
  // view -- authorization was already re-verified above, so this uses the
  // service-role client the same way whatsapp-link/video-url do.
  const serviceClient = createSupabaseServiceRoleClient();
  const { data: offre } = await serviceClient
    .from("offres")
    .select("type, config")
    .eq("id", transaction.offre_id)
    .single();

  if (offre?.type !== "contenu_debloque") {
    return NextResponse.json({ error: "offre non applicable" }, { status: 400 });
  }

  const r2Key = (offre.config as { r2_key?: string } | null)?.r2_key;
  if (!r2Key) {
    return NextResponse.json(
      { error: "aucun contenu associé à cette offre" },
      { status: 404 },
    );
  }

  const signedUrl = await getSignedDownloadUrl(r2Key);
  return NextResponse.json({ url: signedUrl, expiresInSeconds: 3600 });
}
