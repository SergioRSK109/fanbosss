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

export type MediaKind = "video" | "audio" | "image";

// Fan gallery (Phase 2/4): derived from MEDIA_EXTENSIONS_BY_CONTENT_TYPE
// above -- never a second, hand-maintained extension->kind table that
// could silently drift from the one Phase 1's upload route actually
// writes. A content type's own "image/"/"audio/"/"video/" prefix is
// what decides the kind; every entry in the table above has exactly one
// of those three prefixes, so this reversal is total and unambiguous.
const MEDIA_KIND_BY_EXTENSION: Record<string, MediaKind> = Object.fromEntries(
  Object.entries(MEDIA_EXTENSIONS_BY_CONTENT_TYPE).map(([contentType, extension]) => {
    const kind: MediaKind = contentType.startsWith("image/")
      ? "image"
      : contentType.startsWith("audio/")
        ? "audio"
        : "video";
    return [extension, kind];
  }),
);

// The inverse of mediaExtensionForContentType(): given an r2_key
// produced by that same upload route, returns the media category its
// own extension implies, or null when the key has no recognized media
// extension at all (no extension, or an unrecognized one -- the
// PDF/ZIP/etc. contenu_debloque case Phase 1 already leaves untouched).
// Only inspects the filename's own last path segment, so a folder
// segment that happens to contain a "." (none do today, but this stays
// correct regardless) can never be mistaken for the extension.
export function mediaKindForR2Key(r2Key: string | null | undefined): MediaKind | null {
  if (!r2Key) {
    return null;
  }
  const filename = r2Key.slice(r2Key.lastIndexOf("/") + 1);
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex === -1) {
    return null;
  }
  const extension = filename.slice(dotIndex).toLowerCase();
  return MEDIA_KIND_BY_EXTENSION[extension] ?? null;
}
