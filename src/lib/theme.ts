// Three-position theme preference (Clair/Sombre/Système), persisted via a
// cookie (never a DB column -- this is a device/browser preference, not
// account data) and read server-side on every request so the resolved
// theme can be baked into the very first byte of HTML (see
// [locale]/layout.tsx) -- no client script, no flash of the wrong theme.
// Pure, no server-only imports, so both the root layout (Server
// Component) and /api/theme (Route Handler) can share the exact same
// parsing/validation without duplicating it.

export type Theme = "light" | "dark" | "system";

export const THEME_COOKIE_NAME = "theme";

// 1 year -- long enough that "persists after closing/reopening the
// browser" (the brief's own explicit requirement) is true in practice
// forever, not a session cookie that would evaporate on browser close.
export const THEME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

// Never trusts a raw cookie value directly -- a missing cookie, a value
// from before this feature existed, or a tampered/malformed one (this is
// client-writable, ordinary cookie data, not a security boundary) all
// fall back to "system" rather than leaking an invalid value into the
// <html data-theme> attribute or the CSS selectors that key off it.
export function parseTheme(value: string | undefined | null): Theme {
  return value === "light" || value === "dark" ? value : "system";
}
