import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/i18n/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/galerie", () => ({
  getGalerieFan: vi.fn(async () => []),
}));

vi.mock("@/lib/r2", () => ({
  getSignedDownloadUrl: vi.fn(async (key: string) => `https://signed.example/${key}`),
}));

vi.mock("@/components/GalerieContent", () => ({
  GalerieContent: () => null,
}));

import { redirect } from "@/i18n/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getGalerieFan } from "@/lib/galerie";
import { GalerieContent } from "@/components/GalerieContent";

function buildSupabaseMock(user: { id: string } | null) {
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => ({
      select: () => ({
        in: async () => ({ data: [] }),
      }),
    }),
  };
}

function buildRequest(searchParams: Record<string, string> = {}) {
  return {
    params: Promise.resolve({ locale: "fr" }),
    searchParams: Promise.resolve(searchParams),
  };
}

// GaleriePage returns a plain React element descriptor in this test
// environment (no renderer) -- <main><h1/><p/><div><GalerieContent/></div></main>,
// so `.props.children` is a real 3-element array and the div's own single
// child is the GalerieContent element this shape lets us inspect directly.
type GaleriePageResult = {
  props: {
    children: [unknown, unknown, { props: { children: { props: { initialCreateurId: string | null } } } }];
  };
};

describe("GET /[locale]/galerie", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects a logged-out visitor to /login, never calling getGalerieFan", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabaseMock(null) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { default: GaleriePage } = await import("@/app/[locale]/galerie/page");

    await expect(GaleriePage(buildRequest())).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith({ href: "/login", locale: "fr" });
    expect(getGalerieFan).not.toHaveBeenCalled();
  });

  it("passes initialCreateurId through to GalerieContent when ?createur= is present", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabaseMock({ id: "fan-1" }) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { default: GaleriePage } = await import("@/app/[locale]/galerie/page");
    const result = (await GaleriePage(
      buildRequest({ createur: "createur-9" }),
    )) as unknown as GaleriePageResult;

    expect(getGalerieFan).toHaveBeenCalledWith("fan-1");
    // <main><h1/><p/><div className="mt-6"><GalerieContent .../></div></main>
    // -- the div's own single child is the GalerieContent element.
    expect(result.props.children[2].props.children.props.initialCreateurId).toBe("createur-9");
  });

  it("passes initialCreateurId: null when ?createur= is absent", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabaseMock({ id: "fan-1" }) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { default: GaleriePage } = await import("@/app/[locale]/galerie/page");
    const result = (await GaleriePage(buildRequest())) as unknown as GaleriePageResult;

    expect(result.props.children[2].props.children.props.initialCreateurId).toBeNull();
  });

  it("treats a non-string ?createur= value (e.g. repeated param) as absent", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabaseMock({ id: "fan-1" }) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { default: GaleriePage } = await import("@/app/[locale]/galerie/page");
    const result = (await GaleriePage({
      params: Promise.resolve({ locale: "fr" }),
      searchParams: Promise.resolve({ createur: ["a", "b"] }),
    })) as unknown as GaleriePageResult;

    expect(result.props.children[2].props.children.props.initialCreateurId).toBeNull();
  });

  it("mounts GalerieContent for a logged-in visitor with an empty gallery (no crash)", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabaseMock({ id: "fan-1" }) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );
    vi.mocked(getGalerieFan).mockResolvedValue([]);

    const { default: GaleriePage } = await import("@/app/[locale]/galerie/page");
    const result = await GaleriePage(buildRequest());

    expect(result).not.toBeNull();
    expect(GalerieContent).toBeDefined();
  });
});
