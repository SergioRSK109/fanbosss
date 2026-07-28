import { describe, expect, it } from "vitest";
import { checkUploadSize, MAX_UPLOAD_SIZE_BYTES, maxUploadSizeBytes } from "@/lib/r2";

describe("maxUploadSizeBytes", () => {
  it("caps images at MAX_UPLOAD_SIZE_BYTES.image", () => {
    expect(maxUploadSizeBytes("image/jpeg")).toBe(MAX_UPLOAD_SIZE_BYTES.image);
    expect(maxUploadSizeBytes("image/png")).toBe(MAX_UPLOAD_SIZE_BYTES.image);
  });

  it("falls back to MAX_UPLOAD_SIZE_BYTES.video for anything else (video, arbitrary contenu_debloque types)", () => {
    expect(maxUploadSizeBytes("video/mp4")).toBe(MAX_UPLOAD_SIZE_BYTES.video);
    expect(maxUploadSizeBytes("application/pdf")).toBe(MAX_UPLOAD_SIZE_BYTES.video);
    expect(maxUploadSizeBytes("application/octet-stream")).toBe(MAX_UPLOAD_SIZE_BYTES.video);
  });
});

describe("checkUploadSize", () => {
  it("accepts a positive size within the image cap", () => {
    const result = checkUploadSize(5 * 1024 * 1024, "image/jpeg");
    expect(result.ok).toBe(true);
    expect(result.maxBytes).toBe(MAX_UPLOAD_SIZE_BYTES.image);
  });

  it("rejects a size over the image cap", () => {
    const result = checkUploadSize(MAX_UPLOAD_SIZE_BYTES.image + 1, "image/jpeg");
    expect(result.ok).toBe(false);
  });

  it("accepts a size exactly at the cap (boundary)", () => {
    expect(checkUploadSize(MAX_UPLOAD_SIZE_BYTES.image, "image/jpeg").ok).toBe(true);
    expect(checkUploadSize(MAX_UPLOAD_SIZE_BYTES.video, "video/mp4").ok).toBe(true);
  });

  it("rejects a size over the video cap", () => {
    const result = checkUploadSize(MAX_UPLOAD_SIZE_BYTES.video + 1, "video/mp4");
    expect(result.ok).toBe(false);
    expect(result.maxBytes).toBe(MAX_UPLOAD_SIZE_BYTES.video);
  });

  it("rejects zero, negative, non-finite, and missing sizes", () => {
    expect(checkUploadSize(0, "image/jpeg").ok).toBe(false);
    expect(checkUploadSize(-1, "image/jpeg").ok).toBe(false);
    expect(checkUploadSize(NaN, "image/jpeg").ok).toBe(false);
    expect(checkUploadSize(Infinity, "image/jpeg").ok).toBe(false);
  });
});
