"use client";

import { useLocale } from "next-intl";
import { useEffect, useRef } from "react";
import { PublicationContentLink } from "@/components/PublicationContentLink";
import { EyeIcon, RepostIcon } from "@/components/ui/icons";
import { formatVuesCount } from "@/lib/formatCount";
import { publicationPermalinkHref } from "@/lib/publicationLinks";
import type { Publication } from "@/lib/publications";
import { useVideoViewCounter } from "@/lib/useVideoViewCounter";

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
  const locale = useLocale();

  const videoRef = useRef<HTMLVideoElement>(null);

  // Counted against the EFFECTIVE (original) publication's own id -- a
  // repost row has no video_r2_key of its own (publications_media_exclusif),
  // so incrementer_vue_publication() would silently no-op if given the
  // repost's id instead; the original is genuinely what's playing here.
  useVideoViewCounter(videoRef, effective.id);

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
          <>
            <video
              ref={videoRef}
              src={effective.videoUrl}
              muted
              loop
              playsInline
              preload="metadata"
              className="h-full w-full object-cover"
            />
            {/* View-count overlay -- video tiles only, per the brief;
                an image/text tile has no view count to show at all
                (vuesCount stays 0 forever for those, enforced at the DB
                level by incrementer_vue_publication's own WHERE clause,
                not just by this component choosing not to render it). */}
            <div
              aria-hidden
              className="absolute bottom-1.5 left-1.5 z-10 flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-xs font-semibold text-white"
            >
              <EyeIcon className="h-3.5 w-3.5" />
              {formatVuesCount(effective.vuesCount, locale)}
            </div>
          </>
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
