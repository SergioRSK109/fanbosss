import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";

function buildSupabase(
  user: { id: string } | null,
  existing: Record<string, unknown> | null,
  updateResult: { data: unknown; error: { message: string } | null } = { data: existing, error: null },
) {
  const updateSpy = vi.fn((payload: Record<string, unknown>) => ({
    payload,
    eq: () => ({
      select: () => ({
        single: async () => updateResult,
      }),
    }),
  }));

  return {
    client: {
      auth: { getUser: async () => ({ data: { user } }) },
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({ data: existing, error: existing ? null : { message: "not found" } }),
          }),
        }),
        update: updateSpy,
      }),
    },
    updateSpy,
  };
}

function buildRequest(id: string, body: Record<string, unknown>) {
  return {
    request: new Request(`http://localhost/api/offres/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: Promise.resolve({ id }),
  };
}

const campagneOffre = { id: "offre-1", type: "campagne", createur_id: "u1" };

describe("PATCH /api/offres/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an unauthenticated caller", async () => {
    const { client } = buildSupabase(null, campagneOffre);
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { PATCH } = await import("@/app/api/offres/[id]/route");
    const { request, params } = buildRequest("offre-1", { actif: false });
    const response = await PATCH(request as never, { params });

    expect(response.status).toBe(401);
  });

  it("rejects a caller who doesn't own the offre", async () => {
    const { client } = buildSupabase({ id: "someone-else" }, campagneOffre);
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { PATCH } = await import("@/app/api/offres/[id]/route");
    const { request, params } = buildRequest("offre-1", { actif: false });
    const response = await PATCH(request as never, { params });

    expect(response.status).toBe(403);
  });

  // Migration 0049: whenever actif is explicitly part of the request,
  // desactive_manuellement must be set in the exact same update call --
  // this is what campagnes_publiques (migration 0049) relies on to hide
  // a manually-deactivated campagne while still showing one that closed
  // naturally (close_expired_campagnes()/close_campagne_if_goal_reached()
  // never touch this column at all).
  it("sets desactive_manuellement=true in the same update when actif is turned off", async () => {
    const { client, updateSpy } = buildSupabase({ id: "u1" }, campagneOffre);
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { PATCH } = await import("@/app/api/offres/[id]/route");
    const { request, params } = buildRequest("offre-1", { actif: false });
    await PATCH(request as never, { params });

    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ actif: false, desactive_manuellement: true }),
    );
  });

  it("sets desactive_manuellement=false in the same update when actif is turned back on", async () => {
    const { client, updateSpy } = buildSupabase({ id: "u1" }, campagneOffre);
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { PATCH } = await import("@/app/api/offres/[id]/route");
    const { request, params } = buildRequest("offre-1", { actif: true });
    await PATCH(request as never, { params });

    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ actif: true, desactive_manuellement: false }),
    );
  });

  it("never sends desactive_manuellement at all when actif isn't part of the request", async () => {
    const { client, updateSpy } = buildSupabase({ id: "u1" }, campagneOffre);
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { PATCH } = await import("@/app/api/offres/[id]/route");
    const { request, params } = buildRequest("offre-1", { image_r2_key: "produits/offre-1/photo.jpg" });
    await PATCH(request as never, { params });

    const sentPayload = updateSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sentPayload).not.toHaveProperty("desactive_manuellement");
  });

  it("surfaces the DB's own rejection (e.g. whatsapp price floor) as a 400", async () => {
    const whatsappOffre = { id: "offre-2", type: "whatsapp", createur_id: "u1" };
    const { client } = buildSupabase({ id: "u1" }, whatsappOffre);
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { PATCH } = await import("@/app/api/offres/[id]/route");
    const { request, params } = buildRequest("offre-2", { prix: 5 });
    const response = await PATCH(request as never, { params });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/whatsapp/);
  });
});
