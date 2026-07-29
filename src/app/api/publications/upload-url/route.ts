import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { checkUploadSize, getSignedUploadUrl } from "@/lib/r2";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Same "verify with the real client first" pattern as content-upload-url
// (offres): re-checks the caller is an admin or a créateur_verifie before
// ever minting an upload URL -- publier_message() itself re-verifies this
// exact same rule again at insert time (defense in depth, never trust
// the client alone), so a rejected upload here is redundant with, not a
// substitute for, that RPC-level check.
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const { data: profil } = await supabase
    .from("users")
    .select("est_admin, createur_verifie")
    .eq("id", user.id)
    .single();

  if (!profil?.est_admin && !profil?.createur_verifie) {
    return NextResponse.json(
      { error: "réservé aux créateurs vérifiés ou aux admins" },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const contentType = String(body.contentType ?? "");
  const size = Number(body.size);

  if (!contentType.startsWith("image/")) {
    return NextResponse.json({ error: "seules les images sont acceptées" }, { status: 400 });
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

  const r2Key = `publications/${user.id}/${randomUUID()}`;
  const uploadUrl = await getSignedUploadUrl(r2Key, contentType, size);

  return NextResponse.json({ uploadUrl, r2Key });
}
