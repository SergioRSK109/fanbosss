import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { checkUploadSize, getSignedUploadUrl } from "@/lib/r2";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Same R2 upload pipeline as offres/[id]/image-upload-url and
// publications/upload-url: verify ownership with the real, authenticated
// client first, then mint a presigned PUT URL with the same 10MB image
// cap the security audit already established. Ownership is checked
// directly against the raw `concours` table -- readable here via
// concours_select_involved (migration 0047), the same policy that lets
// the organizer read their own pourcentage_maitre_jeu. Reserved to the
// concours organizer only; definir_photo_trophee_concours() (below,
// called after the PUT) independently re-verifies this same check --
// this route minting a URL is never itself a write to the database.
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

  const { data: concours, error } = await supabase
    .from("concours")
    .select("id, organisateur_id")
    .eq("id", id)
    .single();

  if (error || !concours) {
    return NextResponse.json({ error: "concours introuvable" }, { status: 404 });
  }

  if (concours.organisateur_id !== user.id) {
    return NextResponse.json({ error: "not authorized" }, { status: 403 });
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

  const r2Key = `concours/${id}/${randomUUID()}`;
  const uploadUrl = await getSignedUploadUrl(r2Key, contentType, size);

  return NextResponse.json({ uploadUrl, r2Key });
}
