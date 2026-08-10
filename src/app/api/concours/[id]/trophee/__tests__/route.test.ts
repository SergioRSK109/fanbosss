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
    request: new Request(`http://localhost/api/concours/${id}/trophee`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: Promise.resolve({ id }),
  };
}

const VALID_BODY = { r2Key: "concours/abc/trophee.jpg" };

describe("PATCH /api/concours/[id]/trophee", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an unauthenticated request", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(null, null) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { PATCH } = await import("@/app/api/concours/[id]/trophee/route");
    const { request, params } = buildRequest("c1", VALID_BODY);
    const response = await PATCH(request as never, { params });

    expect(response.status).toBe(401);
  });

  it("rejects an empty r2Key with 400 before calling the RPC", async () => {
    const supabase = buildSupabase({ id: "u1" }, null);
    const rpcSpy = vi.spyOn(supabase, "rpc");
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { PATCH } = await import("@/app/api/concours/[id]/trophee/route");
    const { request, params } = buildRequest("c1", { r2Key: "" });
    const response = await PATCH(request as never, { params });

    expect(response.status).toBe(400);
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("surfaces the RPC's own rejection (e.g. a non-organizer) as a 400", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(
        { id: "u1" },
        { message: "not authorized: only the concours organizer can set the trophy photo" },
      ) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { PATCH } = await import("@/app/api/concours/[id]/trophee/route");
    const { request, params } = buildRequest("c1", VALID_BODY);
    const response = await PATCH(request as never, { params });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("not authorized: only the concours organizer can set the trophy photo");
  });

  it("returns ok and passes the trimmed r2Key once the RPC succeeds", async () => {
    const supabase = buildSupabase({ id: "u1" }, null);
    const rpcSpy = vi.spyOn(supabase, "rpc");
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { PATCH } = await import("@/app/api/concours/[id]/trophee/route");
    const { request, params } = buildRequest("c1", VALID_BODY);
    const response = await PATCH(request as never, { params });

    expect(response.status).toBe(200);
    expect(rpcSpy).toHaveBeenCalledWith("definir_photo_trophee_concours", {
      p_concours_id: "c1",
      p_r2_key: "concours/abc/trophee.jpg",
    });
  });
});
