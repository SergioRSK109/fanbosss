import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { checkUploadSize, getSignedUploadUrl } from "@/lib/r2";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Phase 1 of the "produit physique" offer type -- no offre had an image
// before this route existed (see CLAUDE.md), same R2 upload pipeline as
// content-upload-url (offres) and publications/upload-url: verify
// ownership with the real, authenticated client first, then mint a
// presigned PUT URL with the same 10MB image cap the security audit
// already established (checkUploadSize/MAX_UPLOAD_SIZE_BYTES.image).
// Restricted to type === "produit" for now, same "one type, one clear
// purpose per route" discipline as content-upload-url's own
// contenu_debloque restriction -- image_r2_key itself carries no DB-level
// type restriction, so loosening this later for another offer type that
// wants an image is a one-line change, not a schema migration.
//
// No UI calls this yet (Phase 2, out of scope for this lot) -- this is
// just the route + its write to offres.image_r2_key, per the brief.
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

  if (offre.type !== "produit") {
    return NextResponse.json(
      { error: "cette route ne concerne que les offres produit" },
      { status: 400 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const contentType = String(body.contentType ?? "");
  const size = Number(body.size);

  if (!contentType.startsWith("image/")) {
    return NextResponse.json(
      { error: "seules les images sont acceptées" },
      { status: 400 },
    );
  }

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
