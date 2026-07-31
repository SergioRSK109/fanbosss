import type { ReactNode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";

// Security audit fix: /home used to be deliberately reachable while
// logged out (Lot 5a's original design). This is now reversed -- a
// logged-out visitor must be redirected to /login, same guard every
// other (app) page already uses (see login/signup's own redirect tests
// for the exact same mocking shape).
vi.mock("@/i18n/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECTED");
  }),
  Link: (props: { href: string; children?: ReactNode }) => props,
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

vi.mock("@/lib/publications", () => ({
  getPublicationsAccueil: vi.fn(async () => ({ publications: [], total: 0 })),
  getViewerContext: vi.fn(async () => ({ viewerId: "u1", canManagePublications: false })),
  PUBLICATIONS_ACCUEIL_PAGE_SIZE: 10,
}));

// Nav reorg lot: /home now fetches its own notifications (bell moved out
// of the shared (app) layout into this page's own header) -- mocked out
// the same way getPublicationsAccueil already is, so this test never
// depends on the fake Supabase client implementing the real
// notifications query shape.
vi.mock("@/lib/notifications", () => ({
  getNotifications: vi.fn(async () => []),
  getUnreadNotificationCount: vi.fn(async () => 0),
}));

vi.mock("@/components/PublicationComposer", () => ({
  PublicationComposer: () => null,
}));

vi.mock("@/components/PublicationsList", () => ({
  PublicationsList: () => null,
}));

import { redirect } from "@/i18n/navigation";
import { getPublicationsAccueil } from "@/lib/publications";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function buildSupabase(user: { id: string } | null) {
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: null }) }),
      }),
    }),
  };
}

describe("GET /[locale]/home", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects a logged-out visitor to /login instead of showing the public feed", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(null) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { default: HomePage } = await import("@/app/[locale]/home/page");

    await expect(
      HomePage({
        params: Promise.resolve({ locale: "fr" }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow("REDIRECTED");

    expect(redirect).toHaveBeenCalledWith({ href: "/login", locale: "fr" });
    // The whole point of migration 0033's anon-grant revoke: an
    // unauthenticated visitor must never even reach the query that reads
    // publications_accueil.
    expect(getPublicationsAccueil).not.toHaveBeenCalled();
  });

  it("renders the feed for a logged-in visitor, without redirecting", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { default: HomePage } = await import("@/app/[locale]/home/page");
    const result = await HomePage({
      params: Promise.resolve({ locale: "fr" }),
      searchParams: Promise.resolve({}),
    });

    expect(result).toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
    expect(getPublicationsAccueil).toHaveBeenCalled();
  });
});
