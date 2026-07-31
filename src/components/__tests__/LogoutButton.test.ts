import { describe, expect, it, vi } from "vitest";

// LogoutButton also exports the client component, which calls useRouter
// from @/i18n/navigation -- importing the module pulls that in even
// though this test only exercises signOutAndRedirect, and next-intl's
// navigation helper doesn't resolve under plain Vitest (no jsdom/next
// runtime). Mocked the same way the Home page test handles it.
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const { signOutAndRedirect } = await import("@/components/LogoutButton");

// Regression test for "there is no logout anywhere in the app". Confirms
// the button doesn't just navigate away (which would leave the session
// cookie intact and let a direct revisit to a protected page skip past
// auth) -- supabase.auth.signOut() must actually resolve *before* the
// redirect fires. The real, live-browser proof that this invalidates the
// session server-side (not just clearing local state) is documented in
// CLAUDE.md under "Logout" -- signOut()'s default "global" scope revokes
// the session via the Supabase Auth API, and a direct revisit to a
// protected page afterward was verified to bounce back to /login.
describe("signOutAndRedirect", () => {
  it("calls supabase.auth.signOut() before navigating home", async () => {
    const order: string[] = [];
    const supabase = {
      auth: {
        signOut: vi.fn(async () => {
          order.push("signOut");
          return { error: null };
        }),
      },
    };
    const router = {
      push: vi.fn((href: string) => order.push(`push:${href}`)),
      refresh: vi.fn(() => order.push("refresh")),
    };

    await signOutAndRedirect(supabase, router);

    expect(order).toEqual(["signOut", "push:/", "refresh"]);
    expect(supabase.auth.signOut).toHaveBeenCalledTimes(1);
  });
});
