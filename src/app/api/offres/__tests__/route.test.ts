import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";

function buildSupabase(
  user: { id: string } | null,
  upsertResult: { data: unknown; error: { message: string } | null },
) {
  const upsertSpy = vi.fn((payload: Record<string, unknown>) => ({
    payload,
    select: () => ({
      single: async () => upsertResult,
    }),
  }));

  return {
    client: {
      auth: { getUser: async () => ({ data: { user } }) },
      from: () => ({
        // GET-style count check (isFirstOffre) and the actual upsert both
        // go through from("offres") in this route -- select() here backs
        // the count check, upsert() backs the real write.
        select: () => ({
          eq: () => Promise.resolve({ count: 1 }),
        }),
        upsert: upsertSpy,
      }),
    },
    upsertSpy,
  };
}

function buildRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/offres", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_CAMPAGNE = {
  type: "campagne",
  libelle: "Toit pour l'église",
  config: { description: "x", objectif: 1000 },
};

describe("POST /api/offres", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an unauthenticated request", async () => {
    const { client } = buildSupabase(null, { data: null, error: null });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/offres/route");
    const response = await POST(buildRequest(VALID_CAMPAGNE) as never);

    expect(response.status).toBe(401);
  });

  // Migration 0049: this route -- the créateur's real désactiver/réactiver
  // upsert, not PATCH /api/offres/[id] -- is what OffresManager's own
  // toggle button actually calls (see that component's CampagneRow/
  // VideoOffreRow/ProduitRow, all of which submit here). The same
  // manual-vs-natural-closure signal campagnes_publiques relies on has to
  // be set here too, or the real button a créateur clicks would never
  // record it.
  it("sets desactive_manuellement=true in the same upsert when actif is turned off", async () => {
    const { client, upsertSpy } = buildSupabase(
      { id: "u1" },
      { data: { id: "offre-1", ...VALID_CAMPAGNE, actif: false }, error: null },
    );
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/offres/route");
    await POST(buildRequest({ ...VALID_CAMPAGNE, actif: false }) as never);

    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ actif: false, desactive_manuellement: true }),
      expect.anything(),
    );
  });

  it("sets desactive_manuellement=false in the same upsert when actif is turned back on", async () => {
    const { client, upsertSpy } = buildSupabase(
      { id: "u1" },
      { data: { id: "offre-1", ...VALID_CAMPAGNE, actif: true }, error: null },
    );
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/offres/route");
    await POST(buildRequest({ ...VALID_CAMPAGNE, actif: true }) as never);

    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ actif: true, desactive_manuellement: false }),
      expect.anything(),
    );
  });

  it("never sends desactive_manuellement at all when actif isn't part of the request", async () => {
    const { client, upsertSpy } = buildSupabase(
      { id: "u1" },
      { data: { id: "offre-1", ...VALID_CAMPAGNE }, error: null },
    );
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/offres/route");
    await POST(buildRequest(VALID_CAMPAGNE) as never);

    const sentPayload = upsertSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sentPayload).not.toHaveProperty("desactive_manuellement");
  });

  it("surfaces the DB's own rejection as a 400", async () => {
    const { client } = buildSupabase(
      { id: "u1" },
      { data: null, error: { message: "some constraint violation" } },
    );
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/offres/route");
    const response = await POST(buildRequest(VALID_CAMPAGNE) as never);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("some constraint violation");
  });
});
