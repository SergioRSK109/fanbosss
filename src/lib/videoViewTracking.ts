// Pure logic behind the shared video-view-counting hook
// (useVideoViewCounter.ts) -- this project has no jsdom/testing-library,
// so the DOM-touching hook itself can't be rendered in a test; the
// furthest-position tracking and the 30% threshold decision are
// extracted here instead, same DOM-free-vs-DOM-touching split already
// established for imageCrop.ts/videoDuration.ts.

// A view counts once playback has genuinely covered 30% of the video,
// per the brief -- not merely been seeked past. Deliberately no holiday-
// style config knob for this; it's the one number the brief specifies.
export const VIEW_COUNT_THRESHOLD_FRACTION = 0.3;

// Never regresses on a seek backward -- the furthest position ever
// reached is what matters, so this is always max(previous, current), not
// a plain reassignment. Guards a zero/negative/non-finite duration
// (metadata not loaded yet) by returning the previous value unchanged
// rather than producing NaN/Infinity.
export function computeFurthestFraction(
  previousFurthestFraction: number,
  currentTimeSeconds: number,
  durationSeconds: number,
): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return previousFurthestFraction;
  }
  const currentFraction = currentTimeSeconds / durationSeconds;
  return Math.max(previousFurthestFraction, currentFraction);
}

export function shouldCountView(furthestFraction: number): boolean {
  return furthestFraction >= VIEW_COUNT_THRESHOLD_FRACTION;
}
