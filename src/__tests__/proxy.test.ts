import { describe, expect, it, vi } from "vitest";

// next-intl/middleware transitively imports "next/server" in a way that
// doesn't resolve under plain Vitest (no Next.js runtime) -- mocked the
// same way other tests in this project sidestep that (see
// [locale]/__tests__/page.test.ts). config.matcher itself is a plain
// literal array, unaffected by what createIntlMiddleware actually does,
// so this only avoids the import-time crash, not the thing under test.
vi.mock("next-intl/middleware", () => ({
  default: () => () => {},
}));

const { config } = await import("@/proxy");

// Regression test for a real, empirically-reproduced bug (see CLAUDE.md
// "Email confirmation / password reset link 404"): /api was excluded from
// next-intl's rewrite in this matcher, but /auth was not, so every
// signup-confirmation/password-reset link to /auth/callback 404'd --
// next-intl still rewrites an *unprefixed* request into the [locale] tree
// internally even under localePrefix:"as-needed", and there is no
// app/[locale]/auth/callback route (it deliberately lives outside
// [locale], same as /api). This asserts the exclusion directly against
// the matcher regex actually shipped, not a copy of it, so a future edit
// that silently drops "auth" fails a test instead of 404ing in production.
describe("proxy matcher", () => {
  const [pattern] = config.matcher;
  const matcher = new RegExp(`^${pattern}$`);

  it("excludes /auth/callback and /api routes from next-intl's rewrite", () => {
    expect(matcher.test("/auth/callback")).toBe(false);
    expect(matcher.test("/api/offres")).toBe(false);
  });

  it("still includes real [locale] pages", () => {
    expect(matcher.test("/login")).toBe(true);
    expect(matcher.test("/dashboard")).toBe(true);
    expect(matcher.test("/reinitialiser-mot-de-passe")).toBe(true);
  });
});
