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

// Ascending bars (a podium/bar-chart reading of "leaderboard"), used only
// in /home's own header linking to /classement -- deliberately distinct
// from the trophy emoji (🏆) the root nav's own /classement link already
// uses elsewhere, since this one has to work as a plain SVG glyph. No
// active/inactive state: it's a static link, not a toggle, same reasoning
// as icons.tsx's own MenuIcon.
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
      <rect x="4" y="13" width="4" height="7" />
      <rect x="10" y="8.5" width="4" height="11.5" />
      <rect x="16" y="4.5" width="4" height="15.5" />
    </svg>
  );
}
