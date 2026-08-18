import { describe, expect, it } from "vitest";
import { mediaExtensionForContentType } from "@/lib/mediaExtension";

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
