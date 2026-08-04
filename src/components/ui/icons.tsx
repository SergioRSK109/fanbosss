// Lot 5c: hand-made inline SVG icons for the publication action bar
// (like/repost/share/menu) -- this project has no icon library
// (lucide-react confirmed absent) and otherwise leans on plain emoji, but
// these 4 buttons warrant a consistent SVG treatment instead of a mix of
// emoji. Every path uses `currentColor` -- never a hardcoded hex -- so
// the wrapping button's own text-color class (e.g. text-danger-500,
// text-accent-500, text-foreground-muted) is what actually paints the
// icon, in both light and dark mode, exactly like this codebase's other
// CSS-variable-driven color usage.
type IconProps = {
  className?: string;
  // Outline at rest; filled once the viewer has taken the action. Heart
  // and share/paper-plane are natural closed shapes, so the exact same
  // path is reused for both states, just toggling fill vs stroke. Repost
  // has no natural solid-fill body (it's two open arrows around a loop),
  // so its "filled" state is expressed on the two arrowheads instead --
  // see RepostIcon's own comment.
  active?: boolean;
};

// Instagram-style heart silhouette, single stroke outline at rest, fully
// filled (no stroke at all) once liked.
export function HeartIcon({ className, active }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill={active ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={active ? 0 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 20.3c-.3 0-.6-.1-.8-.3C7.8 17 3 12.9 3 8.8 3 5.9 5.2 3.7 8 3.7c1.6 0 3 .8 4 2.1 1-1.3 2.4-2.1 4-2.1 2.8 0 5 2.2 5 5.1 0 4.1-4.8 8.2-8.2 11.2-.2.2-.5.3-.8.3z" />
    </svg>
  );
}

// Retweet convention: a rounded rectangle loop with an arrow at each
// opposite end, pointing in reverse directions. The loop itself is
// always a stroked outline (it has no meaningful solid-fill body); the
// two arrowheads switch from hollow to filled once the viewer has
// reposted, carrying the "filled at the active state" idea on the part
// of the glyph that actually has an area to fill.
export function RepostIcon({ className, active }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        d="M7 6h7a3 3 0 0 1 3 3v2M17 18h-7a3 3 0 0 1-3-3v-2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10 3 7 6l3 3"
        fill={active ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14 21l3-3-3-3"
        fill={active ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Telegram-style paper-plane send icon: a rounded triangle pointing
// up-right at ~45°, outline at rest, filled once shared.
export function ShareIcon({ className, active }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill={active ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={active ? 0 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3.4 11.2 20.6 3.3c.6-.3 1.2.3 1 .9L17 20.6c-.2.6-.9.8-1.4.4l-4.6-3.8-2.6 2.5c-.4.4-1.1.1-1.1-.4v-4l-4-1.7c-.6-.2-.6-1.1.1-1.4z" />
    </svg>
  );
}

// Three equal, evenly-spaced parallel bars -- opens the "..." menu
// (signaler / ne plus voir les publications de ce créateur). No
// active/inactive state, it's a menu trigger, not a toggle.
export function MenuIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden
    >
      <line x1="4" y1="6.5" x2="20" y2="6.5" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17.5" x2="20" y2="17.5" />
    </svg>
  );
}

// Migration 0043: the Explorer grid's view-count overlay. Classic
// almond-eye outline + a solid pupil -- purely informational (a raw
// public metric, not a per-viewer toggle), so unlike Heart/Repost/Share
// above it has no active/inactive state at all.
export function EyeIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
