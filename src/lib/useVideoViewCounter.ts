"use client";

import { useEffect, useRef } from "react";
import { computeFurthestFraction, shouldCountView } from "@/lib/videoViewTracking";

// Shared by PublicationTile.tsx (Explorer grid, autoplay loop) and
// PublicationVideoPlayer.tsx (the in-feed/permalink/fullscreen-viewer
// player) -- one single definition of "when does a video view count",
// per the brief's own explicit instruction, so the two surfaces can
// never silently disagree about it.
//
// Listens to `timeupdate`, tracks the furthest playback position ever
// reached (never reset by seeking backward -- computeFurthestFraction is
// a max, not a reassignment), and fires incrementer_vue_publication()
// exactly once per mount the instant that maximum crosses 30% of the
// video's duration, then stops listening for the rest of this viewing
// session (removeEventListener, not just a guard flag) -- a re-mount
// (e.g. the tile scrolling out and back into the DOM) starts a fresh
// session, matching "once per viewing session" rather than "once ever".
export function useVideoViewCounter(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  publicationId: string,
) {
  const furthestFractionRef = useRef(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    furthestFractionRef.current = 0;

    function handleTimeUpdate() {
      if (!video) {
        return;
      }
      furthestFractionRef.current = computeFurthestFraction(
        furthestFractionRef.current,
        video.currentTime,
        video.duration,
      );

      if (shouldCountView(furthestFractionRef.current)) {
        video.removeEventListener("timeupdate", handleTimeUpdate);
        // Fire-and-forget, same "a missed metric isn't worth surfacing an
        // error to the viewer" posture as every other best-effort side
        // effect in this codebase (e.g. the webhook's own notification
        // call) -- a failed increment here just means one uncounted view,
        // never a broken playback experience.
        fetch(`/api/publications/${publicationId}/vue`, { method: "POST" }).catch(() => {});
      }
    }

    video.addEventListener("timeupdate", handleTimeUpdate);
    return () => video.removeEventListener("timeupdate", handleTimeUpdate);
  }, [videoRef, publicationId]);
}
