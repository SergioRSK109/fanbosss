// Lot: nav bar reorg -- hand-made inline SVG icons for AppTabBar's 5
// destinations, plus the standalone Leaderboard icon used in /home's own
// header. Same discipline as icons.tsx's like/repost/share/menu icons
// (Lot 5c): no icon library, every path/shape uses `currentColor`, so the
// wrapping element's own text-color class (e.g. AppTabBar's
// text-brand-600 vs text-foreground-muted active/inactive classes) is
// what actually paints the icon in both light and dark mode.
type TabIconProps = {
  className?: string;
  // Outline at rest, filled once the tab is the active one -- mirrors
  // icons.tsx's own outline/filled convention, just driven by "is this
  // the current route" instead of a like/repost toggle.
  active?: boolean;
};

export function HomeIcon({ className, active }: TabIconProps) {
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
      <path d="M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" />
    </svg>
  );
}

// Gift box: lid + body as a stroked outline at rest; filled swaps the two
// rectangles solid while the ribbon lines stay stroked on top so the
// crossed-ribbon silhouette still reads once solid.
export function GiftIcon({ className, active }: TabIconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <rect
        x="4"
        y="9.5"
        width="16"
        height="4"
        rx="1"
        fill={active ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <rect
        x="5.5"
        y="13.5"
        width="13"
        height="7"
        rx="1"
        fill={active ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <line x1="12" y1="9.5" x2="12" y2="20.5" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 9.5c-1-2.5-2.5-4-4-4-1.2 0-2 .8-2 1.8 0 1.4 1.6 2.2 6 2.2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M12 9.5c1-2.5 2.5-4 4-4 1.2 0 2 .8 2 1.8 0 1.4-1.6 2.2-6 2.2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Wallet: rounded rectangle body + a card-flap corner + a small clasp
// circle -- the clasp is the one part that switches solid/hollow between
// states, same "toggle the part that has a real fillable area" idea as
// RepostIcon's arrowheads.
export function WalletIcon({ className, active }: TabIconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <rect
        x="3.5"
        y="6.5"
        width="17"
        height="12"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M3.5 10.5h13a2.5 2.5 0 0 1 2.5 2.5v1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle
        cx="16.2"
        cy="13.2"
        r="1.4"
        fill={active ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}

// Magnifying glass -- matches the emoji (🔎) already used for "Explorer"
// in the root nav (Nav.explorer), rather than a compass, so the same
// action reads consistently wherever it appears.
export function CompassIcon({ className, active }: TabIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 2.2 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="10.5" cy="10.5" r="6" />
      <line x1="15.2" y1="15.2" x2="20" y2="20" />
    </svg>
  );
}

// Person silhouette: head circle + shoulder arc, filled solid once active.
export function UserIcon({ className, active }: TabIconProps) {
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
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20c0-4.1 3.4-6.5 7.5-6.5s7.5 2.4 7.5 6.5" />
    </svg>
  );
}

// Classic champions cup: a flared bowl on a stem/base, with a small
// looped handle on each side -- used only in /home's own header linking
// to /classement, echoing the trophy emoji (🏆) the root nav's own
// /classement link already uses elsewhere, but as a plain hand-made SVG
// glyph rather than an emoji, same convention as every other icon in this
// file. No active/inactive state: it's a static link, not a toggle, same
// reasoning as icons.tsx's own MenuIcon.
// Simple back arrow (shaft + chevron head) -- used by
// PublicationViewerOverlay's floating back button (Lot 5d follow-up).
// Static, no active/inactive state, same reasoning as LeaderboardIcon.
export function BackIcon({ className }: { className?: string }) {
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
      <path d="M19 12H5" />
      <path d="M11 6 5 12l6 6" />
    </svg>
  );
}

// Theme switcher (Clair/Sombre/Système, /parametres) -- same three-icon
// segmented control shape as everywhere else in this file: outline at
// rest, filled/heavier once selected. Sun: circle + 8 rays, rays only
// drawn when active (a bare stroked circle alone reads ambiguously as
// "light" at rest, but the full sun glyph is unambiguous once selected,
// same "fill only communicates the active state" idea as HomeIcon).
export function SunIcon({ className, active }: TabIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 2.2 : 1.8}
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="4.2" fill={active ? "currentColor" : "none"} />
      <line x1="12" y1="2.5" x2="12" y2="5" />
      <line x1="12" y1="19" x2="12" y2="21.5" />
      <line x1="2.5" y1="12" x2="5" y2="12" />
      <line x1="19" y1="12" x2="21.5" y2="12" />
      <line x1="4.9" y1="4.9" x2="6.6" y2="6.6" />
      <line x1="17.4" y1="17.4" x2="19.1" y2="19.1" />
      <line x1="4.9" y1="19.1" x2="6.6" y2="17.4" />
      <line x1="17.4" y1="6.6" x2="19.1" y2="4.9" />
    </svg>
  );
}

// Crescent moon -- a circle with a second, offset circle subtracted via
// even-odd fill, the standard crescent construction; filled solid once
// active, same convention as every other icon in this file.
export function MoonIcon({ className, active }: TabIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill={active ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={active ? 0 : 1.8}
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" />
    </svg>
  );
}

// Monitor/display -- screen rectangle on a small stand, the standard
// "match system" glyph used across virtually every OS-level theme picker.
export function SystemIcon({ className, active }: TabIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 2.2 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect
        x="3.5"
        y="4.5"
        width="17"
        height="12"
        rx="1.5"
        fill={active ? "currentColor" : "none"}
      />
      <line x1="8.5" y1="20" x2="15.5" y2="20" />
      <line x1="12" y1="16.5" x2="12" y2="20" />
    </svg>
  );
}

export function LeaderboardIcon({ className }: { className?: string }) {
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
      {/* Bowl: wide flared rim tapering down to a narrow point at the stem */}
      <path d="M7.5 4h9l-1.2 5c-.4 2.5-1.7 4.5-3.3 4.5s-2.9-2-3.3-4.5Z" />
      {/* Side handles, one loop each */}
      <path d="M7.8 5.4a2.6 2.3 0 0 0 0 4.6" />
      <path d="M16.2 5.4a2.6 2.3 0 0 1 0 4.6" />
      {/* Stem + base */}
      <line x1="12" y1="13.5" x2="12" y2="16.5" />
      <path d="M9 16.5h6M8 19h8" />
    </svg>
  );
}
