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

vi.mock("@/lib/galerie", () => ({
  getGalerieFan: vi.fn(),
}));

vi.mock("@/components/CreateurProfileView", () => ({
  CreateurProfileView: () => null,
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCreateurProfileData } from "@/lib/profil";
import { getGalerieFan } from "@/lib/galerie";

function buildSupabaseMock(ilikeSpy: (pattern: string) => void, user: { id: string } | null = null) {
  return {
    auth: { getUser: async () => ({ data: { user } }) },
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

describe("GET /[locale]/[handle]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCreateurProfileData).mockResolvedValue({
      createurId: "createur-1",
      displayName: null,
      createurVerifie: false,
      bio: null,
      photoUrl: null,
      couvertureUrl: null,
      lienReseauSocial: null,
      socialLinks: { tiktok: null, instagram: null, youtube: null, autre: null },
      offres: [],
      campagnes: [],
      produits: [],
      ranks: { volume: null, reactivite: null, progression: null },
      donorPalier: null,
      supporters: [],
      badgesFidelite: [],
      publications: [],
      viewerCanRepost: false,
      viewerId: null,
    });
    vi.mocked(getGalerieFan).mockResolvedValue([]);
  });

  describe("percent-encoded '@' bug", () => {
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

  // Fan gallery (Phase 4): this page's own auth.getUser() call must never
  // gate/redirect the page itself -- it's consulted purely to decide
  // whether to show a "voir dans ma galerie" link. These tests are the
  // concrete proof (not an assumption) that a logged-out visitor still
  // gets a fully rendered profile, and that the extra getGalerieFan call
  // only ever fires for a real session.
  describe("contextual gallery link", () => {
    it("renders normally for a logged-out visitor, without ever calling getGalerieFan", async () => {
      const ilikeSpy = vi.fn();
      vi.mocked(createSupabaseServerClient).mockResolvedValue(
        buildSupabaseMock(ilikeSpy, null) as unknown as Awaited<
          ReturnType<typeof createSupabaseServerClient>
        >,
      );

      const { default: HandlePage } = await import("@/app/[locale]/[handle]/page");
      // HandlePage returns a plain React element descriptor here (no
      // renderer in this test environment) -- `.props` is exactly what
      // was passed to <CreateurProfileView .../>, the real thing this
      // test needs to check.
      const result = (await HandlePage({
        params: Promise.resolve({ handle: "%40sergio" }),
      })) as { props: { hasGalerieItems: boolean } };

      expect(result).not.toBeNull();
      expect(getGalerieFan).not.toHaveBeenCalled();
      expect(result.props.hasGalerieItems).toBe(false);
    });

    it("calls getGalerieFan filtered to this créateur only when a fan is logged in", async () => {
      const ilikeSpy = vi.fn();
      vi.mocked(createSupabaseServerClient).mockResolvedValue(
        buildSupabaseMock(ilikeSpy, { id: "fan-1" }) as unknown as Awaited<
          ReturnType<typeof createSupabaseServerClient>
        >,
      );
      vi.mocked(getGalerieFan).mockResolvedValue([
        {
          transactionId: "tx-1",
          createurId: "createur-1",
          mediaType: "video",
          deliveredAt: "2026-01-01T00:00:00.000Z",
          expiresAt: null,
          deliveryRoute: "video-url",
          imageUrl: null,
        },
      ]);

      const { default: HandlePage } = await import("@/app/[locale]/[handle]/page");
      const result = (await HandlePage({
        params: Promise.resolve({ handle: "%40sergio" }),
      })) as { props: { hasGalerieItems: boolean } };

      expect(getGalerieFan).toHaveBeenCalledWith("fan-1", { createurId: "createur-1" });
      expect(result.props.hasGalerieItems).toBe(true);
    });

    it("passes hasGalerieItems: false for a logged-in fan who has received nothing from this créateur", async () => {
      const ilikeSpy = vi.fn();
      vi.mocked(createSupabaseServerClient).mockResolvedValue(
        buildSupabaseMock(ilikeSpy, { id: "fan-2" }) as unknown as Awaited<
          ReturnType<typeof createSupabaseServerClient>
        >,
      );
      vi.mocked(getGalerieFan).mockResolvedValue([]);

      const { default: HandlePage } = await import("@/app/[locale]/[handle]/page");
      const result = (await HandlePage({
        params: Promise.resolve({ handle: "%40sergio" }),
      })) as { props: { hasGalerieItems: boolean } };

      expect(result.props.hasGalerieItems).toBe(false);
    });

    it("passes hasGalerieItems: false for the créateur viewing their own profile (no self-transactions)", async () => {
      const ilikeSpy = vi.fn();
      // The créateur themself is logged in -- same id as the profile
      // being viewed (createur-1).
      vi.mocked(createSupabaseServerClient).mockResolvedValue(
        buildSupabaseMock(ilikeSpy, { id: "createur-1" }) as unknown as Awaited<
          ReturnType<typeof createSupabaseServerClient>
        >,
      );
      vi.mocked(getGalerieFan).mockResolvedValue([]);

      const { default: HandlePage } = await import("@/app/[locale]/[handle]/page");
      const result = (await HandlePage({
        params: Promise.resolve({ handle: "%40sergio" }),
      })) as { props: { hasGalerieItems: boolean } };

      expect(getGalerieFan).toHaveBeenCalledWith("createur-1", { createurId: "createur-1" });
      expect(result.props.hasGalerieItems).toBe(false);
    });
  });
});
