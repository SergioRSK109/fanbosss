// Fan gallery (Phase 1/4): contenu_debloque accepts an arbitrary
// ContentType at upload (see src/lib/r2.ts's own comment on
// maxUploadSizeBytes) but never recorded which one, anywhere -- so
// there was no reliable way to later tell whether a given unlocked
// file is a video/audio/photo (what the future /galerie needs to
// filter on) versus a PDF/ZIP/other non-media file a créateur is
// still free to sell exactly as today.
//
// Rather than a new column/JSON key, this reuses the exact pattern
// already established for personalized video delivery
// (videos/${id}/${uuid}.mp4, upload-url/route.ts): the r2_key's own
// extension is the record. Pure, DOM/database-free -- same reasoning
// as campagnes.ts/contenuDebloque.ts -- so later phases (deciding
// whether an item belongs in the gallery) can reuse this exact
// mapping without re-deriving it.
//
// Deliberately NOT exhaustive and NOT a whitelist: an unrecognized or
// missing content type falls back to no extension at all, identical
// to today's behavior -- a créateur must still be able to sell a PDF
// or ZIP as contenu_debloque with zero change in behavior.
const MEDIA_EXTENSIONS_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/wav": ".wav",
  "audio/ogg": ".ogg",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
};

// Returns the recognized media extension (e.g. ".jpg") for a known
// image/audio/video content type, or "" for anything else (unknown,
// missing, or a non-media type like application/pdf) -- "" is what
// keeps the r2_key exactly as it is today for every unrecognized case.
export function mediaExtensionForContentType(contentType: string | null | undefined): string {
  if (!contentType) {
    return "";
  }
  return MEDIA_EXTENSIONS_BY_CONTENT_TYPE[contentType] ?? "";
}
