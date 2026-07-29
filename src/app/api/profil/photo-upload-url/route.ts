import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { checkUploadSize, getSignedUploadUrl } from "@/lib/r2";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Profile photo upload only happens post-signup, authenticated (brief
// point 4 discussion): a signup-time upload would need a working R2 PUT
// URL before the account exists, which either requires an unauthenticated
// upload endpoint (abuse risk) or a chicken-and-egg id problem. Simpler
// and safer to collect bio/social link at signup (plain text metadata,
// same pattern as telephone/pays) and defer the photo to here.
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const contentType = String(body.contentType ?? "image/jpeg");
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

  const r2Key = `profils/${user.id}/${randomUUID()}`;
  const uploadUrl = await getSignedUploadUrl(r2Key, contentType, size);

  return NextResponse.json({ uploadUrl, r2Key });
}
