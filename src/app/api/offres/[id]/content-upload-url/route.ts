import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { checkUploadSize, getSignedUploadUrl } from "@/lib/r2";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// contenu_debloque is uploaded once, at the offer level, not per
// transaction (brief v3 point 2b): every fan who pays unlocks the same
// pre-uploaded file. Créateur-only; RLS (offres_select_own,
// createur_id = auth.uid()) scopes this to the offer's owner. After
// calling this, the créateur PATCHes /api/offres/[id] with
// { config: { r2_key } } to record where the upload landed.
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

  const { data: offre, error } = await supabase
    .from("offres")
    .select("id, type, createur_id")
    .eq("id", id)
    .single();

  if (error || !offre) {
    return NextResponse.json({ error: "offre introuvable" }, { status: 404 });
  }

  if (offre.createur_id !== user.id) {
    return NextResponse.json({ error: "not authorized" }, { status: 403 });
  }

  if (offre.type !== "contenu_debloque") {
    return NextResponse.json(
      { error: "cette route ne concerne que les offres contenu_debloque" },
      { status: 400 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const contentType = String(body.contentType ?? "application/octet-stream");
  const size = Number(body.size);

  const sizeCheck = checkUploadSize(size, contentType);
  if (!sizeCheck.ok) {
    return NextResponse.json(
      {
        error: `fichier trop volumineux (taille maximale : ${Math.round(sizeCheck.maxBytes / (1024 * 1024))} Mo)`,
      },
      { status: 400 },
    );
  }

  const r2Key = `offres/${id}/${randomUUID()}`;
  const uploadUrl = await getSignedUploadUrl(r2Key, contentType, size);

  return NextResponse.json({ uploadUrl, r2Key });
}
