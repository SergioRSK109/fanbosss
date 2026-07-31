// Cover photo processing -- deliberately simpler than PhotoCropper's
// interactive pan/zoom/rotate flow (src/lib/imageCrop.ts): a banner is a
// wide, non-square target, and generalizing that already-tested square
// crop geometry to an arbitrary aspect ratio would be a real rework, not
// a small tweak. This is a plain, automatic "object-fit: cover" style
// crop -- always centered, no interaction -- which still solves the one
// problem that actually matters for uploads (re-encoding every source
// format/dimension to a consistent JPEG before it ever reaches R2, same
// reasoning as the profile photo's own crop step). If interactive
// positioning is wanted later, this is the file to extend, not replace.
export const COVER_EXPORT_WIDTH = 1200;
export const COVER_EXPORT_HEIGHT = 400;

// Pure and DOM-free, same split as imageCrop.ts/videoDuration.ts -- the
// part that's actually unit-testable without a browser. Scales the
// source image up (never down past 1:1 in either axis) so it fully
// covers the target rectangle, then centers it -- identical math to CSS
// `object-fit: cover; object-position: center`, just computed for a
// canvas draw instead of layout.
export function computeCoverDrawGeometry(naturalWidth: number, naturalHeight: number) {
  const scale = Math.max(
    COVER_EXPORT_WIDTH / naturalWidth,
    COVER_EXPORT_HEIGHT / naturalHeight,
  );
  const drawWidth = naturalWidth * scale;
  const drawHeight = naturalHeight * scale;

  return {
    drawWidth,
    drawHeight,
    offsetX: (COVER_EXPORT_WIDTH - drawWidth) / 2,
    offsetY: (COVER_EXPORT_HEIGHT - drawHeight) / 2,
  };
}

// DOM-touching (loads the file into a real <img>, draws to a real
// canvas), not unit-tested directly -- this project has no jsdom, same
// reasoning PhotoCropper's own canvas-drawing half isn't unit-tested
// either. Always exports a consistent "image/jpeg" blob regardless of
// the source format (HEIC, PNG...) or dimensions -- same fix as the
// profile photo's own crop step for the same underlying
// Content-Type/mobile-upload risk (see CLAUDE.md "Mobile upload bug").
export function processCoverPhotoFile(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      const canvas = document.createElement("canvas");
      canvas.width = COVER_EXPORT_WIDTH;
      canvas.height = COVER_EXPORT_HEIGHT;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("canvas unavailable"));
        return;
      }

      const { drawWidth, drawHeight, offsetX, offsetY } = computeCoverDrawGeometry(
        img.naturalWidth,
        img.naturalHeight,
      );
      ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);

      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error("export failed"));
          }
        },
        "image/jpeg",
        0.9,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("unsupported format"));
    };
    img.src = objectUrl;
  });
}
