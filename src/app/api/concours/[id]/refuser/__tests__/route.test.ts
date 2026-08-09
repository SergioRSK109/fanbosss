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

function buildRequest(id: string) {
  return {
    request: new Request(`http://localhost/api/concours/${id}/refuser`, { method: "POST" }),
    params: Promise.resolve({ id }),
  };
}

describe("POST /api/concours/[id]/refuser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an unauthenticated request", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(null, null) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/concours/[id]/refuser/route");
    const { request, params } = buildRequest("c1");
    const response = await POST(request as never, { params });

    expect(response.status).toBe(401);
  });

  it("surfaces the RPC's own rejection (e.g. already resolved) as a 400", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, { message: "invitation already resolved" }) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/concours/[id]/refuser/route");
    const { request, params } = buildRequest("c1");
    const response = await POST(request as never, { params });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invitation already resolved");
  });

  it("returns ok once the RPC succeeds", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, null) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/concours/[id]/refuser/route");
    const { request, params } = buildRequest("c1");
    const response = await POST(request as never, { params });

    expect(response.status).toBe(200);
  });
});
