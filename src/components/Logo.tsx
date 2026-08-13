// Same mark/wordmark as public/fanboss-logo.svg, but rendered inline
// (rather than referenced via <img src="...">) so its colors can use the
// site's actual CSS variables (--color-brand-500/--color-accent-500,
// globals.css) instead of the logo file's approximate hardcoded hex
// values -- a referenced external SVG can't inherit the host page's CSS
// custom properties, so this is the only way for the nav logo to follow
// --color-brand-500's dark-mode override automatically.
//
// Crown symbol (validated in Claude Design, "Option 3") replaced the
// original gradient-filled rounded square + lightning bolt -- the exact
// 3-path outline below, verbatim, per explicit instruction not to
// redraw it. Its own native coordinate space is a 48x48 box (the same
// slot the old mark occupied at x=4,y=4 in this component's outer
// viewBox), so it's nested here via its own `<svg>` rather than
// transformed/rescaled. Outline only -- `fill="none"`,
// `stroke="currentColor"` -- same "no color baked into the path itself"
// discipline as every icon in navIcons.tsx/icons.tsx: currentColor is
// resolved here via an explicit `style={{ color: ... }}` on the nested
// svg (the CSS variable, not a hardcoded hex), matching how the wordmark
// tspans below already set their own fill from the same two variables.
// No more `<linearGradient>`/`useId()` (the old mark's only reason to be
// a client component at all, despite having no interactivity) -- this
// is a plain, deterministic Server Component now.
//
// strokeWidth="2" -- lost during the original integration (fell back to
// the SVG default of 1), reintroduced to match the Claude Design source.
//
// The nested viewBox is NOT the path's own "0 0 48 48" native box --
// the 3 paths' real geometry only occupies a fraction of that (the 3
// crown arcs are exact semicircles, since each chord length equals the
// radius*2 diameter: 9.7 = 2*4.85), so the true bounding box of the 3
// paths combined is x:[9.3, 38.4] y:[18.15, 39], not [0,48]x[0,48].
// Tightened to that real box plus a small margin (>= half the 2px
// stroke width, so the stroke itself is never clipped) so the symbol
// visually fills its 48x48 slot instead of floating in mostly-empty
// space -- verified by computing each arc's center/radius by hand, not
// eyeballed.
export function Logo({ className = "h-8 w-auto" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 220 56"
      role="img"
      aria-label="FanBoss"
      className={className}
    >
      <title>FanBoss</title>
      <svg
        x="4"
        y="4"
        width="48"
        height="48"
        viewBox="7.8 16.65 32.1 23.85"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ color: "var(--color-brand-500)" }}
      >
        <path d="M9.3 31V23A4.85 4.85 0 0 1 19 23A4.85 4.85 0 0 1 28.7 23A4.85 4.85 0 0 1 38.4 23V31" />
        <path d="M9.3 31H38.4V36.4A2.6 2.6 0 0 1 35.8 39H11.9A2.6 2.6 0 0 1 9.3 36.4Z" />
        <path d="M23.85 32.7C21.35 34.2 21.35 36.4 23.85 37.9C26.35 36.4 26.35 34.2 23.85 32.7Z" />
      </svg>
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
