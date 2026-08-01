"use client";

import { Link } from "@/i18n/navigation";

// A native <video controls> element's own play/pause/seek/volume/
// fullscreen controls are rendered by the browser as an internal overlay
// -- clicking them still dispatches a plain "click" on the <video>
// element itself (there's no distinguishable sub-target to check), so
// the only reliable way to tell "clicked a control" apart from "clicked
// the video frame" is the click's vertical position: browsers render the
// native control strip along the bottom edge. Generous on purpose (wider
// than Chrome's actual ~32px bar) so a slightly-imprecise click on a
// control never accidentally opens the viewer instead.
const VIDEO_CONTROLS_ZONE_PX = 48;

// Wraps a publication's text/image/video content in a link to its
// permalink, opening the fullscreen viewer (an intercepted route, see
// src/app/[locale]/@modal) on internal navigation. `display: contents`
// keeps the wrapping <a> invisible to layout, so it doesn't disturb the
// flex/gap spacing PublicationBody already relies on between its
// children. A client component specifically so PublicationCard/
// PublicationBody themselves can stay Server Components -- only the
// click-guard logic below needs the browser.
export function PublicationContentLink({
  href,
  children,
  hasVideoControls = true,
}: {
  // Null when the publication's author has no pseudo (no working
  // permalink exists at all) -- renders children unwrapped, never a
  // link guaranteed to 404.
  href: string | null;
  children: React.ReactNode;
  // Phase C: Explorer's grid tiles render a muted, autoplaying,
  // loop-only <video> with no native `controls` at all (Instagram-style)
  // -- there's no bottom control strip to protect a click from, so the
  // whole tile should navigate on any click, including near the bottom
  // edge. Defaults true, preserving the in-feed <video controls> call
  // sites' existing behavior unchanged.
  hasVideoControls?: boolean;
}) {
  if (!href) {
    return <>{children}</>;
  }

  function handleClick(event: React.MouseEvent<HTMLAnchorElement>) {
    if (!hasVideoControls) {
      return;
    }
    const video = (event.target as HTMLElement).closest("video");
    if (!video) {
      return;
    }
    const rect = video.getBoundingClientRect();
    const clickY = event.clientY - rect.top;
    if (clickY >= rect.height - VIDEO_CONTROLS_ZONE_PX) {
      // Click landed on the native controls strip -- let the video
      // handle play/pause/seek/volume/fullscreen itself, same in-feed
      // behavior as before this feature (no navigation).
      event.preventDefault();
    }
  }

  return (
    <Link href={href} onClick={handleClick} className="contents">
      {children}
    </Link>
  );
}
