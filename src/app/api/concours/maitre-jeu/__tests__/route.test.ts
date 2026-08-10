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
  return new Request("http://localhost/api/concours/maitre-jeu", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  nom: "Tournoi sponsorisé",
  dateFin: new Date(Date.now() + 86400000).toISOString(),
  pourcentageMaitreJeu: 20,
};

describe("POST /api/concours/maitre-jeu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an unauthenticated request", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(null, { data: null, error: null }) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/concours/maitre-jeu/route");
    const response = await POST(buildRequest(VALID_BODY) as never);

    expect(response.status).toBe(401);
  });

  it("rejects an out-of-bounds pourcentageMaitreJeu with 400 before calling the RPC", async () => {
    const supabase = buildSupabase({ id: "u1" }, { data: null, error: null });
    const rpcSpy = vi.spyOn(supabase, "rpc");
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/concours/maitre-jeu/route");
    const response = await POST(buildRequest({ ...VALID_BODY, pourcentageMaitreJeu: 101 }) as never);

    expect(response.status).toBe(400);
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("surfaces the RPC's own rejection as a 400", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(
        { id: "u1" },
        { data: null, error: { message: "p_pourcentage_maitre_jeu must be between 0 and 100" } },
      ) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/concours/maitre-jeu/route");
    const response = await POST(buildRequest(VALID_BODY) as never);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("p_pourcentage_maitre_jeu must be between 0 and 100");
  });

  it("returns the new concours id once the RPC succeeds, forwarding the exact percentage", async () => {
    const supabase = buildSupabase(
      { id: "u1" },
      { data: "22222222-2222-4222-8222-222222222222", error: null },
    );
    const rpcSpy = vi.spyOn(supabase, "rpc");
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/concours/maitre-jeu/route");
    const response = await POST(buildRequest(VALID_BODY) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe("22222222-2222-4222-8222-222222222222");
    expect(rpcSpy).toHaveBeenCalledWith("creer_concours_maitre_jeu", {
      p_nom: "Tournoi sponsorisé",
      p_date_fin: VALID_BODY.dateFin,
      p_pourcentage_maitre_jeu: 20,
    });
  });
});
