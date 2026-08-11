import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";

function buildSupabase(user: { id: string } | null, rpcError: { message: string } | null) {
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    rpc: async () => ({ error: rpcError }),
  };
}

function buildRequest(id: string, body: unknown) {
  return {
    request: new Request(`http://localhost/api/concours/${id}/accepter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: Promise.resolve({ id }),
  };
}

const VALID_BODY = {};

describe("POST /api/concours/[id]/accepter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an unauthenticated request", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(null, null) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/concours/[id]/accepter/route");
    const { request, params } = buildRequest("c1", VALID_BODY);
    const response = await POST(request as never, { params });

    expect(response.status).toBe(401);
  });

  it("rejects a malformed body (conditionsAcceptees not a boolean) with 400 before calling the RPC", async () => {
    const supabase = buildSupabase({ id: "u1" }, null);
    const rpcSpy = vi.spyOn(supabase, "rpc");
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/concours/[id]/accepter/route");
    const { request, params } = buildRequest("c1", { conditionsAcceptees: "yes" });
    const response = await POST(request as never, { params });

    expect(response.status).toBe(400);
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("surfaces the RPC's own rejection (e.g. invitation not found) as a 400", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(
        { id: "u1" },
        { message: "invitation not found" },
      ) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/concours/[id]/accepter/route");
    const { request, params } = buildRequest("c1", VALID_BODY);
    const response = await POST(request as never, { params });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invitation not found");
  });

  it("returns ok once the RPC succeeds", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, null) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/concours/[id]/accepter/route");
    const { request, params } = buildRequest("c1", VALID_BODY);
    const response = await POST(request as never, { params });

    expect(response.status).toBe(200);
  });

  // Migration 0047: p_conditions_acceptees defaults to false when the
  // entre_createurs flow never sends it, and is threaded through
  // verbatim when the maitre_du_jeu consent screen does.
  it("passes p_conditions_acceptees=false by default (entre_createurs never sends it)", async () => {
    const supabase = buildSupabase({ id: "u1" }, null);
    const rpcSpy = vi.spyOn(supabase, "rpc");
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/concours/[id]/accepter/route");
    const { request, params } = buildRequest("c1", VALID_BODY);
    await POST(request as never, { params });

    expect(rpcSpy).toHaveBeenCalledWith(
      "accepter_invitation_concours",
      expect.objectContaining({ p_conditions_acceptees: false }),
    );
  });

  it("passes p_conditions_acceptees=true when the consent screen sent it", async () => {
    const supabase = buildSupabase({ id: "u1" }, null);
    const rpcSpy = vi.spyOn(supabase, "rpc");
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/concours/[id]/accepter/route");
    const { request, params } = buildRequest("c1", { ...VALID_BODY, conditionsAcceptees: true });
    await POST(request as never, { params });

    expect(rpcSpy).toHaveBeenCalledWith(
      "accepter_invitation_concours",
      expect.objectContaining({ p_conditions_acceptees: true }),
    );
  });
});
