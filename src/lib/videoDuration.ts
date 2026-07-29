// Security audit fix: a créateur delivering a video/shoutout transaction
// must not be able to upload an arbitrarily long video. Checked at file
// *selection* time, before any upload ever starts -- this is what
// actually addresses the root cause (an overly long video is what makes
// the file large in the first place), rather than only capping bytes
// after the fact (see checkUploadSize()/getSignedUploadUrl() in
// src/lib/r2.ts, the size-based safety net behind this).
export const MAX_VIDEO_DURATION_SECONDS = 90;

// Pure and DOM-free, same split as src/lib/imageCrop.ts's own
// geometry-vs-canvas separation -- this is the part that's actually
// unit-testable without a browser.
export function isVideoDurationAllowed(durationSeconds: number): boolean {
  return (
    Number.isFinite(durationSeconds) &&
    durationSeconds > 0 &&
    durationSeconds <= MAX_VIDEO_DURATION_SECONDS
  );
}

// DOM-touching (a throwaway <video> element, same technique every
// browser-based video-duration check uses), not unit-tested directly --
// this project has no jsdom/testing-library, same reasoning
// PhotoCropper's own canvas-drawing half isn't unit-tested either. Reads
// metadata only (`preload = "metadata"`): the browser only needs to
// parse the file's container/header to learn its duration, not decode
// the whole video, so this resolves near-instantly even for a large file
// and never actually uploads anything.
export function readVideoDurationSeconds(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    const objectUrl = URL.createObjectURL(file);
    let settled = false;

    function cleanup() {
      URL.revokeObjectURL(objectUrl);
      video.removeAttribute("src");
      video.load();
    }

    video.onloadedmetadata = () => {
      if (settled) return;
      settled = true;
      const duration = video.duration;
      cleanup();
      resolve(duration);
    };
    video.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("cannot read video metadata"));
    };
    video.src = objectUrl;
  });
}
