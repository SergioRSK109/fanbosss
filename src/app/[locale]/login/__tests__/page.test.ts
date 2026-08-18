import { describe, expect, it, vi, beforeEach } from "vitest";

// Regression test for a real bug, reproduced against a live login flow
// (not assumed from reading the code -- see CLAUDE.md "Logo-click
// 'logout' bug"): the session was never actually destroyed by anything
// in this app. The confusing "I got logged out" experience came from
// this page rendering the login form unconditionally, even for an
// already-authenticated visitor who landed here confused after Home
// didn't reflect their auth state either. This asserts the fix: an
// authenticated visitor is redirected away before the form ever renders.
vi.mock("@/i18n/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

vi.mock("@/app/[locale]/login/LoginForm", () => ({
  LoginForm: () => null,
}));

vi.mock("@/components/AuthPageHeader", () => ({
  AuthPageHeader: () => null,
}));

import { redirect } from "@/i18n/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function buildSupabaseMock(user: { id: string } | null) {
  return {
    auth: {
      getUser: async () => ({ data: { user } }),
    },
  };
}

describe("GET /[locale]/login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects an already-authenticated visitor to /home instead of showing the form", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabaseMock({ id: "user-1" }) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { default: LoginPage } = await import("@/app/[locale]/login/page");

    await expect(
      LoginPage({ params: Promise.resolve({ locale: "fr" }) }),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(redirect).toHaveBeenCalledWith({ href: "/home", locale: "fr" });
  });

  it("renders the login form for a logged-out visitor, without redirecting", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabaseMock(null) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { default: LoginPage } = await import("@/app/[locale]/login/page");
    const result = await LoginPage({ params: Promise.resolve({ locale: "fr" }) });

    expect(redirect).not.toHaveBeenCalled();
    expect(result).toBeTruthy();
  });
});
