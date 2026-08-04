import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";

function buildSupabase(
  user: { id: string } | null,
  rpcError: { message: string } | null,
  rpcSpy?: (name: string, args: unknown) => void,
) {
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    rpc: async (name: string, args: unknown) => {
      rpcSpy?.(name, args);
      return { error: rpcError };
    },
  };
}

function buildRequest(id: string) {
  return {
    request: new Request(`http://localhost/api/publications/${id}/vue`, { method: "POST" }),
    params: Promise.resolve({ id }),
  };
}

describe("POST /api/publications/[id]/vue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("succeeds for a logged-out (anon) caller, unlike every other write route in this project -- a view count is a public, non-sensitive metric and the RPC is granted to anon", async () => {
    const rpcSpy = vi.fn();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(null, null, rpcSpy) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/publications/[id]/vue/route");
    const { request, params } = buildRequest("pub-1");
    const response = await POST(request as never, { params });

    expect(response.status).toBe(200);
    expect(rpcSpy).toHaveBeenCalledWith("incrementer_vue_publication", {
      p_publication_id: "pub-1",
    });
  });

  it("also succeeds for an authenticated caller, with the exact same RPC call", async () => {
    const rpcSpy = vi.fn();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, null, rpcSpy) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/publications/[id]/vue/route");
    const { request, params } = buildRequest("pub-1");
    const response = await POST(request as never, { params });

    expect(response.status).toBe(200);
    expect(rpcSpy).toHaveBeenCalledWith("incrementer_vue_publication", {
      p_publication_id: "pub-1",
    });
  });

  it("surfaces a 400 when the RPC itself rejects the call", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(null, { message: "some db error" }) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/publications/[id]/vue/route");
    const { request, params } = buildRequest("pub-1");
    const response = await POST(request as never, { params });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("some db error");
  });
});
