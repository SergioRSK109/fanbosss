import { describe, expect, it, vi, beforeEach } from "vitest";

// Same reasoning as login/__tests__/page.test.ts.
vi.mock("@/i18n/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/app/[locale]/signup/SignupForm", () => ({
  SignupForm: () => null,
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

describe("GET /[locale]/signup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects an already-authenticated visitor to /home instead of showing the form", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabaseMock({ id: "user-1" }) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { default: SignupPage } = await import("@/app/[locale]/signup/page");

    await expect(
      SignupPage({ params: Promise.resolve({ locale: "fr" }) }),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(redirect).toHaveBeenCalledWith({ href: "/home", locale: "fr" });
  });

  it("renders the signup form for a logged-out visitor, without redirecting", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabaseMock(null) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { default: SignupPage } = await import("@/app/[locale]/signup/page");
    const result = await SignupPage({ params: Promise.resolve({ locale: "fr" }) });

    expect(redirect).not.toHaveBeenCalled();
    expect(result).toBeTruthy();
  });
});
