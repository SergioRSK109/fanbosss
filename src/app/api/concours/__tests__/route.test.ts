import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";

function buildSupabase(
  user: { id: string } | null,
  rpcResult: { data: unknown; error: { message: string } | null },
) {
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    rpc: async () => rpcResult,
  };
}

function buildRequest(body: unknown) {
  return new Request("http://localhost/api/concours", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  nom: "Concours de la rentrée",
  dateFin: new Date(Date.now() + 86400000).toISOString(),
};

describe("POST /api/concours", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an unauthenticated request", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(null, { data: null, error: null }) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/concours/route");
    const response = await POST(buildRequest(VALID_BODY) as never);

    expect(response.status).toBe(401);
  });

  it("rejects a malformed body (empty nom) with 400 before calling the RPC", async () => {
    const supabase = buildSupabase({ id: "u1" }, { data: null, error: null });
    const rpcSpy = vi.spyOn(supabase, "rpc");
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/concours/route");
    const response = await POST(buildRequest({ ...VALID_BODY, nom: "" }) as never);

    expect(response.status).toBe(400);
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("rejects a temps_record with no objectif_points with 400 before calling the RPC", async () => {
    const supabase = buildSupabase({ id: "u1" }, { data: null, error: null });
    const rpcSpy = vi.spyOn(supabase, "rpc");
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/concours/route");
    const response = await POST(
      buildRequest({ ...VALID_BODY, tempsRecord: new Date(Date.now() + 3600000).toISOString() }) as never,
    );

    expect(response.status).toBe(400);
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("surfaces the RPC's own rejection as a 400", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(
        { id: "u1" },
        { data: null, error: { message: "not authenticated" } },
      ) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/concours/route");
    const response = await POST(buildRequest(VALID_BODY) as never);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("not authenticated");
  });

  it("returns the new concours id once the RPC succeeds, with no campagneId ever sent", async () => {
    const supabase = buildSupabase(
      { id: "u1" },
      { data: "22222222-2222-4222-8222-222222222222", error: null },
    );
    const rpcSpy = vi.spyOn(supabase, "rpc");
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/concours/route");
    const response = await POST(buildRequest(VALID_BODY) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe("22222222-2222-4222-8222-222222222222");
    expect(rpcSpy).toHaveBeenCalledWith("creer_concours", {
      p_nom: VALID_BODY.nom,
      p_date_fin: VALID_BODY.dateFin,
      p_date_debut: null,
      p_objectif_points: null,
      p_temps_record: null,
    });
  });

  it("passes date_debut/objectif_points/temps_record through when provided", async () => {
    const supabase = buildSupabase(
      { id: "u1" },
      { data: "22222222-2222-4222-8222-222222222222", error: null },
    );
    const rpcSpy = vi.spyOn(supabase, "rpc");
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const dateDebut = new Date(Date.now() + 3600000).toISOString();
    const tempsRecord = new Date(Date.now() + 7200000).toISOString();

    const { POST } = await import("@/app/api/concours/route");
    await POST(
      buildRequest({ ...VALID_BODY, dateDebut, objectifPoints: 250, tempsRecord }) as never,
    );

    expect(rpcSpy).toHaveBeenCalledWith("creer_concours", {
      p_nom: VALID_BODY.nom,
      p_date_fin: VALID_BODY.dateFin,
      p_date_debut: dateDebut,
      p_objectif_points: 250,
      p_temps_record: tempsRecord,
    });
  });
});
