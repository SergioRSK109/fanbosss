"use client";

import { useEffect, useRef } from "react";
import { PublicationContentLink } from "@/components/PublicationContentLink";
import { RepostIcon } from "@/components/ui/icons";
import { publicationPermalinkHref } from "@/lib/publicationLinks";
import type { Publication } from "@/lib/publications";

// Matches the spec's "~50% visibility" autoplay trigger -- a tile only
// starts playing once at least half of it is actually on screen, and
// pauses the instant it drops back below that, via its own independent
// IntersectionObserver (never a single shared "which video is active"
// flag -- several tiles in the same row can legitimately be >=50%
// visible, and autoplaying all of them at once is correct, not a bug;
// the thing to avoid is a video playing while genuinely off-screen).
const AUTOPLAY_VISIBILITY_THRESHOLD = 0.5;

// One tile in Explorer's Instagram-style publications grid (Phase C).
// Deliberately renders only media -- no author row, no action bar, no
// engagement counts -- the full context (who posted it, likes/reposts,
// the "..." menu) only exists on the permalink view this tile opens via
// PublicationContentLink + the Phase B fullscreen viewer, never
// duplicated here.
export function PublicationTile({ publication }: { publication: Publication }) {
  // A repost tile carries no media/contenu of its own (enforced at the
  // DB level, see publications_contenu_coherent) -- the tile shows the
  // referenced ORIGINAL's media, and clicking it opens the ORIGINAL's
  // permalink, exactly like PublicationBody already does for a repost
  // card in the feed (PublicationCard picks publication.repostDe there
  // for the identical reason). No new logic: the same "repostDe ?? self"
  // resolution the feed already relies on.
  const effective = publication.repostDe ?? publication;
  const href = publicationPermalinkHref(effective);
  const isRepost = publication.repostDe !== null;

  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          // A visitor scrolling fast can trigger a play() the browser
          // then immediately interrupts with a pause() -- both throw a
          // benign AbortError promise rejection in that race, not a
          // real failure; swallowing it is correct here (there's
          // nothing actionable to surface for a muted background loop).
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      },
      { threshold: AUTOPLAY_VISIBILITY_THRESHOLD },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  return (
    <PublicationContentLink href={href} hasVideoControls={false}>
      <div className="relative aspect-[4/5] w-full overflow-hidden rounded-sm bg-surface-muted">
        {isRepost && (
          <div
            aria-hidden
            className="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white"
          >
            <RepostIcon className="h-3.5 w-3.5" />
          </div>
        )}

        {effective.videoUrl ? (
          <video
            ref={videoRef}
            src={effective.videoUrl}
            muted
            loop
            playsInline
            preload="metadata"
            className="h-full w-full object-cover"
          />
        ) : effective.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={effective.imageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brand-500 via-brand-600 to-accent-500 p-3">
            <p className="line-clamp-6 text-center text-xs font-medium text-white">
              {effective.contenu}
            </p>
          </div>
        )}
      </div>
    </PublicationContentLink>
  );
}
