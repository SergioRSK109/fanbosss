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

// Automatic moderation (src/lib/moderation.ts) extracts 2-3 key frames
// from a video entirely client-side and sends only those JPEGs to
// /api/publications/moderer -- never the video itself. This is the same
// "never process video server-side" rule the duration cap above exists
// for (no ffmpeg in this deployment target), extended to a second
// need: reusing the identical <video>/<canvas> mechanism rather than a
// second, parallel implementation.
export const MODERATION_FRAME_COUNT = 3;
const MODERATION_FRAME_MAX_DIMENSION = 512;

// Pure and DOM-free, same split as isVideoDurationAllowed() above --
// spreads timestamps evenly across the clip, nudged off the very first
// and last instants (often a black/empty frame) by a small margin
// capped at a tenth of the clip's own duration so a very short video
// never gets a margin larger than the clip itself.
export function computeFrameTimestamps(durationSeconds: number, frameCount: number = MODERATION_FRAME_COUNT): number[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return [];
  }
  if (frameCount <= 1) {
    return [durationSeconds / 2];
  }
  const margin = Math.min(0.1, durationSeconds / 10);
  const start = margin;
  const end = Math.max(start, durationSeconds - margin);
  const step = (end - start) / (frameCount - 1);
  return Array.from({ length: frameCount }, (_, index) => start + step * index);
}

// DOM-touching, not unit-tested directly -- same reasoning as
// readVideoDurationSeconds() above (this project has no
// jsdom/testing-library). Unlike that function, this needs the video's
// actual frame data, not just its container metadata, so it loads with
// `preload = "auto"` and seeks to each computed timestamp, waiting for
// the browser's own `seeked` event before drawing -- the only reliable
// signal that the frame at that instant has actually decoded and is
// safe to read off the element. Each frame is downscaled to at most
// MODERATION_FRAME_MAX_DIMENSION on its long edge before export (a
// moderation classifier needs a legible frame, not full resolution --
// keeping the request payload small matters more here than for the
// video itself, which is never sent at all).
export function extractVideoFrames(
  file: File,
  frameCount: number = MODERATION_FRAME_COUNT,
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    const objectUrl = URL.createObjectURL(file);
    let settled = false;

    function cleanup() {
      URL.revokeObjectURL(objectUrl);
      video.removeAttribute("src");
      video.load();
    }

    function fail(error: Error) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    }

    video.onerror = () => fail(new Error("cannot read video"));

    video.onloadedmetadata = async () => {
      try {
        const timestamps = computeFrameTimestamps(video.duration, frameCount);
        if (timestamps.length === 0) {
          fail(new Error("cannot read video duration"));
          return;
        }
        const frames: string[] = [];
        for (const timestamp of timestamps) {
          frames.push(await captureFrameAt(video, timestamp));
        }
        if (settled) return;
        settled = true;
        cleanup();
        resolve(frames);
      } catch (error) {
        fail(error instanceof Error ? error : new Error("cannot extract video frames"));
      }
    };

    video.src = objectUrl;
  });
}

function captureFrameAt(video: HTMLVideoElement, timestamp: number): Promise<string> {
  return new Promise((resolve, reject) => {
    function onSeeked() {
      video.removeEventListener("seeked", onSeeked);
      try {
        resolve(drawVideoFrameToBase64Jpeg(video));
      } catch (error) {
        reject(error instanceof Error ? error : new Error("cannot draw video frame"));
      }
    }
    video.addEventListener("seeked", onSeeked);
    video.currentTime = timestamp;
  });
}

// Returns raw base64 (no "data:image/jpeg;base64," prefix) -- the exact
// shape /api/publications/moderer's videoFramesBase64 field expects,
// same as every other base64 field this codebase sends over JSON.
function drawVideoFrameToBase64Jpeg(video: HTMLVideoElement): string {
  const scale = Math.min(1, MODERATION_FRAME_MAX_DIMENSION / Math.max(video.videoWidth, video.videoHeight));
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("canvas 2d context unavailable");
  }
  ctx.drawImage(video, 0, 0, width, height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}
