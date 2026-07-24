"use client";

import { useId } from "react";

// Same mark/wordmark as public/fanboss-logo.svg, but rendered inline
// (rather than referenced via <img src="...">) so its colors can use the
// site's actual CSS variables (--color-brand-500/--color-accent-500,
// globals.css) instead of the logo file's approximate hardcoded hex
// values -- a referenced external SVG can't inherit the host page's CSS
// custom properties, so this is the only way for the nav logo to follow
// --color-brand-500's dark-mode override automatically.
export function Logo({ className = "h-8 w-auto" }: { className?: string }) {
  const gradientId = useId();

  return (
    <svg
      viewBox="0 0 220 56"
      role="img"
      aria-label="FanBoss"
      className={className}
    >
      <title>FanBoss</title>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--color-brand-500)" />
          <stop offset="1" stopColor="var(--color-accent-500)" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="48" height="48" rx="14" fill={`url(#${gradientId})`} />
      <path d="M28 15 L36 30 L30 30 L30 41 L26 41 L26 30 L20 30 Z" fill="#ffffff" />
      <text
        x="64"
        y="37"
        fontSize="26"
        fontWeight="600"
        letterSpacing="0.2"
        style={{ fontFamily: "var(--font-poppins), 'Segoe UI', sans-serif" }}
      >
        <tspan fill="var(--color-brand-500)">Fan</tspan>
        <tspan fill="var(--color-accent-500)">Boss</tspan>
      </text>
    </svg>
  );
}
