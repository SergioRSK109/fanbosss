import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";

function buildSupabase(
  user: { id: string } | null,
  rpcResult: { data?: unknown; error: { message: string } | null } = { data: null, error: null },
  rpcSpy?: (name: string, args: unknown) => void,
) {
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    rpc: async (name: string, args: unknown) => {
      rpcSpy?.(name, args);
      return rpcResult;
    },
  };
}

function buildRequest(body: unknown) {
  return new Request("http://localhost/api/publications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/publications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an unauthenticated request", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(null) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/publications/route");
    const response = await POST(buildRequest({ contenu: "hello" }) as never);

    expect(response.status).toBe(401);
  });

  it("surfaces publier_message()'s own rejection (e.g. rate limit) as a 400", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(
        { id: "u1" },
        { data: null, error: { message: "rate limit exceeded: max 10 publications per 24h" } },
      ) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/publications/route");
    const response = await POST(buildRequest({ contenu: "un message" }) as never);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("rate limit exceeded: max 10 publications per 24h");
  });

  // Migration 0054 -- the field PublicationComposer.tsx sends only after
  // its own /api/publications/moderer call classified the content as
  // "ambigu". Never sent (defaults to null) for a plain publish, which
  // is the overwhelmingly common case and must stay unaffected.
  it("passes signalement_automatique_raison straight through to publier_message() when the client sent one", async () => {
    const rpcSpy = vi.fn();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(
        { id: "u1" },
        {
          data: [{ id: "pub-1", type: "createur", visibilite: "public", created_at: "2026-01-01T00:00:00Z" }],
          error: null,
        },
        rpcSpy,
      ) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/publications/route");
    const response = await POST(
      buildRequest({
        contenu: "un message ambigu",
        signalement_automatique_raison: "ton potentiellement agressif",
      }) as never,
    );

    expect(response.status).toBe(200);
    expect(rpcSpy).toHaveBeenCalledWith(
      "publier_message",
      expect.objectContaining({ p_signalement_automatique_raison: "ton potentiellement agressif" }),
    );
  });

  it("sends p_signalement_automatique_raison: null when the client omits the field (the default, common case)", async () => {
    const rpcSpy = vi.fn();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(
        { id: "u1" },
        {
          data: [{ id: "pub-1", type: "createur", visibilite: "public", created_at: "2026-01-01T00:00:00Z" }],
          error: null,
        },
        rpcSpy,
      ) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/publications/route");
    await POST(buildRequest({ contenu: "un message normal" }) as never);

    expect(rpcSpy).toHaveBeenCalledWith(
      "publier_message",
      expect.objectContaining({ p_signalement_automatique_raison: null }),
    );
  });

  it("rejects a blank/whitespace-only signalement_automatique_raison with a 400, before ever calling the RPC", async () => {
    const rpcSpy = vi.fn();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, { data: null, error: null }, rpcSpy) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/publications/route");
    const response = await POST(
      buildRequest({ contenu: "un message", signalement_automatique_raison: "   " }) as never,
    );

    expect(response.status).toBe(400);
    expect(rpcSpy).not.toHaveBeenCalled();
  });
});
