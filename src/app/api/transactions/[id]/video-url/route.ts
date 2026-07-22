import { NextRequest, NextResponse } from "next/server";
import { getSignedDownloadUrl } from "@/lib/r2";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Brief 0.5: this is the ONLY way a fan can ever reach the video bytes.
// The bucket is private; there is no public URL. Every call re-verifies
// fan_id = auth.uid() AND statut = 'livree' before minting a short-lived
// presigned GET URL -- mirroring the whatsapp-link route, which the brief
// calls out as the correctly-protected reference implementation.
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
    .select("id, fan_id, statut, livrable")
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
      { error: "la vidéo n'a pas encore été livrée" },
      { status: 403 },
    );
  }

  const r2Key = (transaction.livrable as { r2_key?: string } | null)?.r2_key;
  if (!r2Key) {
    return NextResponse.json(
      { error: "aucun fichier associé à cette transaction" },
      { status: 404 },
    );
  }

  const signedUrl = await getSignedDownloadUrl(r2Key);
  return NextResponse.json({ url: signedUrl, expiresInSeconds: 3600 });
}
