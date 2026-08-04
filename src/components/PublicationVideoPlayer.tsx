"use client";

import { useRef } from "react";
import { useVideoViewCounter } from "@/lib/useVideoViewCounter";

// The in-feed/permalink/fullscreen-viewer video player -- extracted out
// of PublicationCard.tsx's own PublicationBody (a Server Component, which
// can't hold a ref or call a hook) specifically so it can share
// useVideoViewCounter with PublicationTile.tsx's own player, per the
// brief's explicit "one single definition, reused by both surfaces"
// instruction. Visually and behaviorally unchanged from the plain
// <video controls muted playsInline> Phase A shipped -- this lot only
// adds the view-counting ref/effect underneath it, nothing about
// playback itself.
export function PublicationVideoPlayer({
  videoUrl,
  publicationId,
  className,
}: {
  videoUrl: string;
  publicationId: string;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useVideoViewCounter(videoRef, publicationId);

  return (
    <video ref={videoRef} src={videoUrl} controls muted playsInline className={className} />
  );
}
