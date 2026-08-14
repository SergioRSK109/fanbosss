import { NextRequest, NextResponse } from "next/server";
import { moderatePublication, type SupportedImageMediaType } from "@/lib/moderation";
import { getObjectBase64 } from "@/lib/r2";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const SUPPORTED_IMAGE_MEDIA_TYPES: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];

function isSupportedImageMediaType(value: string | undefined): value is SupportedImageMediaType {
  return typeof value === "string" && SUPPORTED_IMAGE_MEDIA_TYPES.includes(value);
}

// Called by PublicationComposer.tsx before the existing publier_message()
// call -- authenticated (the same user who's about to publish), never
// exposes the ANTHROPIC_API_KEY or the moderation prompt itself to the
// client. The image is fetched from R2 server-side (imageR2Key, never
// raw bytes over the wire from the client -- same "private bucket,
// server mediates every read" discipline as the rest of this pipeline);
// video frames arrive as base64 already, extracted client-side (see
// src/lib/videoDuration.ts#extractVideoFrames) since this codebase never
// processes video server-side at all.
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const texte = typeof body.texte === "string" ? body.texte : null;
  const imageR2Key = typeof body.imageR2Key === "string" ? body.imageR2Key : null;
  const videoFramesBase64: string[] = Array.isArray(body.videoFramesBase64)
    ? body.videoFramesBase64.filter((frame: unknown): frame is string => typeof frame === "string")
    : [];

  // The r2Key naming convention this route trusts (publications/{userId}/{uuid},
  // see /api/publications/upload-url) -- never fetches an object outside
  // the calling user's own upload prefix, same "never trust client input
  // blindly" discipline as every ownership check elsewhere in this
  // project.
  if (imageR2Key && !imageR2Key.startsWith(`publications/${user.id}/`)) {
    return NextResponse.json({ error: "imageR2Key invalide" }, { status: 400 });
  }

  let image: { data: string; mediaType: SupportedImageMediaType } | null = null;
  if (imageR2Key) {
    try {
      const object = await getObjectBase64(imageR2Key);
      if (isSupportedImageMediaType(object.contentType)) {
        image = { data: object.data, mediaType: object.contentType };
      }
    } catch {
      // A failed R2 read degrades this to text-only moderation rather
      // than aborting the whole call -- moderatePublication() itself
      // already fails all the way open ("ok") on real trouble; this is
      // the same posture one layer up, not a new failure mode.
      image = null;
    }
  }

  const result = await moderatePublication({
    texte,
    imageBase64: image,
    framesBase64: videoFramesBase64.map((data) => ({ data, mediaType: "image/jpeg" as const })),
  });

  return NextResponse.json(result);
}
