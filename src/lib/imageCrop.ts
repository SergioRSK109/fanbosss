// Square, Instagram-style photo crop (product brief): a créateur's photo
// is always re-encoded to a fixed-size square JPEG in the browser before
// it ever reaches R2, regardless of the source format (HEIC, PNG...) or
// dimensions. Geometry kept as plain, DOM-free functions so it's unit
// testable without a real <canvas>; PhotoCropper.tsx only wires these to
// actual CanvasRenderingContext2D calls.

export const CROP_EXPORT_SIZE = 800;
export const CROP_MIN_ZOOM = 1;
export const CROP_MAX_ZOOM = 3;

export interface CropState {
  zoom: number;
  offsetXFrac: number;
  offsetYFrac: number;
  rotationDeg: 0 | 90 | 180 | 270;
}

export const INITIAL_CROP_STATE: CropState = {
  zoom: CROP_MIN_ZOOM,
  offsetXFrac: 0,
  offsetYFrac: 0,
  rotationDeg: 0,
};

// The image is always drawn so its SHORTER natural dimension exactly
// covers the square at zoom=1 (like object-fit: cover), then scaled
// further by `zoom`. `eff*` are the on-screen dimensions AFTER accounting
// for a 90/270 rotation swapping which natural axis maps to width vs
// height -- what actually needs to cover the square, and what panning
// must be clamped against.
export function computeDrawGeometry(
  naturalWidth: number,
  naturalHeight: number,
  size: number,
  zoom: number,
  rotationDeg: CropState["rotationDeg"],
) {
  const baseScale = size / Math.min(naturalWidth, naturalHeight);
  const drawScale = baseScale * zoom;
  const drawWidth = naturalWidth * drawScale;
  const drawHeight = naturalHeight * drawScale;
  const rotated = rotationDeg === 90 || rotationDeg === 270;

  return {
    drawWidth,
    drawHeight,
    effWidth: rotated ? drawHeight : drawWidth,
    effHeight: rotated ? drawWidth : drawHeight,
  };
}

// Keeps the (rotated) image fully covering the square -- no blank
// corners -- by bounding how far its center can be panned from the
// square's center, expressed as a fraction of `size` so the same state
// applies unchanged to a small preview canvas and a larger export canvas.
export function clampOffsetFrac(
  offsetXFrac: number,
  offsetYFrac: number,
  effWidth: number,
  effHeight: number,
  size: number,
) {
  const maxXFrac = Math.max(0, (effWidth - size) / (2 * size));
  const maxYFrac = Math.max(0, (effHeight - size) / (2 * size));

  return {
    offsetXFrac: Math.min(maxXFrac, Math.max(-maxXFrac, offsetXFrac)),
    offsetYFrac: Math.min(maxYFrac, Math.max(-maxYFrac, offsetYFrac)),
  };
}

// Renders the current crop state onto any square canvas -- called at
// preview resolution on every interaction and once more at
// CROP_EXPORT_SIZE for the final export, so the two can never drift
// apart the way two separately-implemented draws could.
export function drawCropToCanvas(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  naturalWidth: number,
  naturalHeight: number,
  size: number,
  state: CropState,
) {
  const { drawWidth, drawHeight } = computeDrawGeometry(
    naturalWidth,
    naturalHeight,
    size,
    state.zoom,
    state.rotationDeg,
  );

  ctx.clearRect(0, 0, size, size);
  ctx.save();
  // Pan in screen space first, THEN rotate around the panned center --
  // otherwise dragging "right" would move the image along its own
  // (possibly rotated) local axis instead of visually right on screen.
  ctx.translate(size / 2 + state.offsetXFrac * size, size / 2 + state.offsetYFrac * size);
  ctx.rotate((state.rotationDeg * Math.PI) / 180);
  ctx.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  ctx.restore();
}
