import { describe, expect, it } from "vitest";
import { mediaExtensionForContentType, mediaKindForR2Key } from "@/lib/mediaExtension";

describe("mediaExtensionForContentType", () => {
  it("maps every recognized image content type", () => {
    expect(mediaExtensionForContentType("image/jpeg")).toBe(".jpg");
    expect(mediaExtensionForContentType("image/png")).toBe(".png");
    expect(mediaExtensionForContentType("image/webp")).toBe(".webp");
    expect(mediaExtensionForContentType("image/gif")).toBe(".gif");
  });

  it("maps every recognized audio content type", () => {
    expect(mediaExtensionForContentType("audio/mpeg")).toBe(".mp3");
    expect(mediaExtensionForContentType("audio/mp4")).toBe(".m4a");
    expect(mediaExtensionForContentType("audio/wav")).toBe(".wav");
    expect(mediaExtensionForContentType("audio/ogg")).toBe(".ogg");
  });

  it("maps every recognized video content type", () => {
    expect(mediaExtensionForContentType("video/mp4")).toBe(".mp4");
    expect(mediaExtensionForContentType("video/quicktime")).toBe(".mov");
    expect(mediaExtensionForContentType("video/webm")).toBe(".webm");
  });

  it("falls back to no extension for a non-media content type (e.g. a PDF/ZIP sale)", () => {
    expect(mediaExtensionForContentType("application/pdf")).toBe("");
    expect(mediaExtensionForContentType("application/zip")).toBe("");
    expect(mediaExtensionForContentType("application/octet-stream")).toBe("");
  });

  it("falls back to no extension for a missing/empty content type", () => {
    expect(mediaExtensionForContentType(undefined)).toBe("");
    expect(mediaExtensionForContentType(null)).toBe("");
    expect(mediaExtensionForContentType("")).toBe("");
  });

  it("is case-sensitive and unknown-subtype-safe -- an unrecognized variant falls back, never a guess", () => {
    expect(mediaExtensionForContentType("Image/JPEG")).toBe("");
    expect(mediaExtensionForContentType("image/svg+xml")).toBe("");
  });
});

describe("mediaKindForR2Key", () => {
  it("resolves every recognized image extension to \"image\"", () => {
    expect(mediaKindForR2Key("offres/offre-1/uuid.jpg")).toBe("image");
    expect(mediaKindForR2Key("offres/offre-1/uuid.png")).toBe("image");
    expect(mediaKindForR2Key("offres/offre-1/uuid.webp")).toBe("image");
    expect(mediaKindForR2Key("offres/offre-1/uuid.gif")).toBe("image");
  });

  it("resolves every recognized audio extension to \"audio\"", () => {
    expect(mediaKindForR2Key("offres/offre-1/uuid.mp3")).toBe("audio");
    expect(mediaKindForR2Key("offres/offre-1/uuid.m4a")).toBe("audio");
    expect(mediaKindForR2Key("offres/offre-1/uuid.wav")).toBe("audio");
    expect(mediaKindForR2Key("offres/offre-1/uuid.ogg")).toBe("audio");
  });

  it("resolves every recognized video extension to \"video\"", () => {
    expect(mediaKindForR2Key("offres/offre-1/uuid.mp4")).toBe("video");
    expect(mediaKindForR2Key("offres/offre-1/uuid.mov")).toBe("video");
    expect(mediaKindForR2Key("offres/offre-1/uuid.webm")).toBe("video");
  });

  it("returns null for a key with no extension at all (a PDF/ZIP contenu_debloque sale, per Phase 1)", () => {
    expect(mediaKindForR2Key("offres/offre-1/6f2b1c8e-uuid-without-extension")).toBeNull();
  });

  it("returns null for an unrecognized extension", () => {
    expect(mediaKindForR2Key("offres/offre-1/uuid.pdf")).toBeNull();
    expect(mediaKindForR2Key("offres/offre-1/uuid.zip")).toBeNull();
  });

  it("returns null for a missing/empty key", () => {
    expect(mediaKindForR2Key(undefined)).toBeNull();
    expect(mediaKindForR2Key(null)).toBeNull();
    expect(mediaKindForR2Key("")).toBeNull();
  });

  it("is a straightforward round-trip with mediaExtensionForContentType for every recognized content type", () => {
    const roundTripCases: Array<[string, "image" | "audio" | "video"]> = [
      ["image/jpeg", "image"],
      ["audio/mpeg", "audio"],
      ["video/mp4", "video"],
    ];
    for (const [contentType, expectedKind] of roundTripCases) {
      const extension = mediaExtensionForContentType(contentType);
      expect(mediaKindForR2Key(`offres/offre-1/uuid${extension}`)).toBe(expectedKind);
    }
  });

  it("only inspects the last path segment's extension, not an unrelated dot elsewhere in the key", () => {
    // Real r2_keys never contain a "." in the offre-id/uuid segments, but
    // this stays correct even if a future segment ever did.
    expect(mediaKindForR2Key("offres/offre.v2/uuid-without-extension")).toBeNull();
  });

  it("is case-insensitive on the extension itself", () => {
    expect(mediaKindForR2Key("offres/offre-1/uuid.JPG")).toBe("image");
  });
});
