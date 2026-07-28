import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { checkUploadSize, getSignedUploadUrl } from "@/lib/r2";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Créateur-only: returns a short-lived presigned PUT URL to upload the
// custom video for a transaction they've accepted. RLS on transactions
// (createur_id = auth.uid()) keeps this scoped to the creator's own work.
export async function POST(
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
    .select("id, createur_id, statut, offres(type)")
    .eq("id", id)
    .single();

  if (error || !transaction) {
    return NextResponse.json({ error: "transaction introuvable" }, { status: 404 });
  }

  const offre = Array.isArray(transaction.offres)
    ? transaction.offres[0]
    : transaction.offres;

  if (transaction.createur_id !== user.id) {
    return NextResponse.json({ error: "not authorized" }, { status: 403 });
  }

  if (offre?.type !== "video" && offre?.type !== "shoutout") {
    return NextResponse.json(
      { error: "seules les offres video/shoutout se livrent par upload" },
      { status: 400 },
    );
  }

  if (transaction.statut !== "validee") {
    return NextResponse.json(
      { error: "la transaction doit être acceptée avant l'upload" },
      { status: 400 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const size = Number(body.size);

  const sizeCheck = checkUploadSize(size, "video/mp4");
  if (!sizeCheck.ok) {
    return NextResponse.json(
      {
        error: `fichier trop volumineux (taille maximale : ${Math.round(sizeCheck.maxBytes / (1024 * 1024))} Mo)`,
      },
      { status: 400 },
    );
  }

  const r2Key = `videos/${id}/${randomUUID()}.mp4`;
  const uploadUrl = await getSignedUploadUrl(r2Key, "video/mp4", size);

  return NextResponse.json({ uploadUrl, r2Key });
}
