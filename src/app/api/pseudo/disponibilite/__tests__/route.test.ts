import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";

const ME_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_ID = "22222222-2222-2222-2222-222222222222";

function buildSupabase(
  user: { id: string } | null,
  matchRow: { id: string } | null,
  selectSpy: (columns: string) => void,
) {
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => ({
      select: (columns: string) => {
        selectSpy(columns);
        return {
          ilike: () => ({
            maybeSingle: async () => ({ data: matchRow }),
          }),
        };
      },
    }),
  };
}

function buildRequest(pseudo: string | null) {
  const url = new URL("http://localhost/api/pseudo/disponibilite");
  if (pseudo !== null) url.searchParams.set("pseudo", pseudo);
  return { nextUrl: url } as unknown as Request & { nextUrl: URL };
}

describe("GET /api/pseudo/disponibilite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an unauthenticated caller without revealing anything", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(null, null, vi.fn()) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { GET } = await import("@/app/api/pseudo/disponibilite/route");
    const response = await GET(buildRequest("sergio") as never);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).not.toHaveProperty("disponible");
  });

  it("requires the pseudo query parameter", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: ME_ID }, null, vi.fn()) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { GET } = await import("@/app/api/pseudo/disponibilite/route");
    const response = await GET(buildRequest(null) as never);

    expect(response.status).toBe(400);
  });

  it("reports an invalid-format pseudo as unavailable without touching the database", async () => {
    const selectSpy = vi.fn();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: ME_ID }, null, selectSpy) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { GET } = await import("@/app/api/pseudo/disponibilite/route");
    const response = await GET(buildRequest("ab") as never); // too short
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ disponible: false });
    expect(selectSpy).not.toHaveBeenCalled();
  });

  it("reports a reserved word as unavailable without touching the database", async () => {
    const selectSpy = vi.fn();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: ME_ID }, null, selectSpy) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { GET } = await import("@/app/api/pseudo/disponibilite/route");
    const response = await GET(buildRequest("Dashboard") as never); // case-insensitive reserved word
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ disponible: false });
    expect(selectSpy).not.toHaveBeenCalled();
  });

  it("reports a pseudo held by someone else as unavailable", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: ME_ID }, { id: OTHER_ID }, vi.fn()) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { GET } = await import("@/app/api/pseudo/disponibilite/route");
    const response = await GET(buildRequest("sergio_123") as never);
    const body = await response.json();

    expect(body).toEqual({ disponible: false });
  });

  it("reports a genuinely free pseudo as available", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: ME_ID }, null, vi.fn()) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { GET } = await import("@/app/api/pseudo/disponibilite/route");
    const response = await GET(buildRequest("sergio_123") as never);
    const body = await response.json();

    expect(body).toEqual({ disponible: true });
  });

  it("excludes the caller's own current pseudo -- reports it as available", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: ME_ID }, { id: ME_ID }, vi.fn()) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { GET } = await import("@/app/api/pseudo/disponibilite/route");
    const response = await GET(buildRequest("sergio_123") as never);
    const body = await response.json();

    expect(body).toEqual({ disponible: true });
  });

  it("selects only `id` from profils_publics -- never anything about the account", async () => {
    const selectSpy = vi.fn();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: ME_ID }, { id: OTHER_ID }, selectSpy) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { GET } = await import("@/app/api/pseudo/disponibilite/route");
    await GET(buildRequest("sergio_123") as never);

    expect(selectSpy).toHaveBeenCalledWith("id");
  });

  it("never returns anything beyond a single `disponible` boolean -- no list, no account details", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: ME_ID }, { id: OTHER_ID }, vi.fn()) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { GET } = await import("@/app/api/pseudo/disponibilite/route");
    const response = await GET(buildRequest("sergio_123") as never);
    const body = await response.json();

    expect(Object.keys(body)).toEqual(["disponible"]);
    expect(typeof body.disponible).toBe("boolean");
  });
});
