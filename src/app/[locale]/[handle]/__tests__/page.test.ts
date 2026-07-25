import { describe, expect, it, vi, beforeEach } from "vitest";

// Real bug, reproduced against a live dev server: Next.js does NOT
// auto-decode the dynamic segment here -- a literal "@sergio" in the URL
// arrives as the raw string "%40sergio" in params.handle, identically
// regardless of locale (confirmed for both /@sergio and /en/@sergio). The
// page must decodeURIComponent() before checking the "@" prefix, or every
// handle 404s.
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/profil", () => ({
  getCreateurProfileData: vi.fn(),
}));

vi.mock("@/components/CreateurProfileView", () => ({
  CreateurProfileView: () => null,
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCreateurProfileData } from "@/lib/profil";

function buildSupabaseMock(ilikeSpy: (pattern: string) => void) {
  return {
    from: () => ({
      select: () => ({
        ilike: (_column: string, pattern: string) => {
          ilikeSpy(pattern);
          return {
            maybeSingle: async () => ({ data: { id: "createur-1" } }),
          };
        },
      }),
    }),
  };
}

describe("GET /[locale]/[handle] (percent-encoded '@' bug)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCreateurProfileData).mockResolvedValue({
      createurId: "createur-1",
      displayName: null,
      bio: null,
      photoUrl: null,
      lienReseauSocial: null,
      socialLinks: { tiktok: null, instagram: null, youtube: null, autre: null },
      offres: [],
      campagnes: [],
      ranks: { volume: null, reactivite: null, progression: null },
    });
  });

  it("decodes a percent-encoded handle ('%40sergio') and looks up 'sergio', not '%40sergio'", async () => {
    const ilikeSpy = vi.fn();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabaseMock(ilikeSpy) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { default: HandlePage } = await import("@/app/[locale]/[handle]/page");
    await HandlePage({ params: Promise.resolve({ handle: "%40sergio" }) });

    expect(ilikeSpy).toHaveBeenCalledWith("sergio");
  });

  it("still 404s a handle that doesn't start with '@' once decoded", async () => {
    const ilikeSpy = vi.fn();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabaseMock(ilikeSpy) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { default: HandlePage } = await import("@/app/[locale]/[handle]/page");

    await expect(
      HandlePage({ params: Promise.resolve({ handle: "not-a-handle" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(ilikeSpy).not.toHaveBeenCalled();
  });
});
