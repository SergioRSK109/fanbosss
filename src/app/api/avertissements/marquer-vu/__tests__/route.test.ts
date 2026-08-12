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

function buildRequest(body: unknown) {
  return new Request("http://localhost/api/avertissements/marquer-vu", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/avertissements/marquer-vu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an unauthenticated request", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(null, null) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/avertissements/marquer-vu/route");
    const response = await POST(buildRequest({ avertissementId: "a1" }) as never);

    expect(response.status).toBe(401);
  });

  it("requires avertissementId", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, null) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/avertissements/marquer-vu/route");
    const response = await POST(buildRequest({}) as never);

    expect(response.status).toBe(400);
  });

  it("surfaces the RPC's rejection (e.g. someone else's, or already vu) as a 400", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, { message: "avertissement not found or already vu" }) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/avertissements/marquer-vu/route");
    const response = await POST(buildRequest({ avertissementId: "a1" }) as never);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("avertissement not found or already vu");
  });

  it("passes avertissementId through to marquer_avertissement_vu", async () => {
    const rpcSpy = vi.fn();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, null, rpcSpy) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/avertissements/marquer-vu/route");
    const response = await POST(buildRequest({ avertissementId: "a1" }) as never);

    expect(response.status).toBe(200);
    expect(rpcSpy).toHaveBeenCalledWith("marquer_avertissement_vu", {
      p_avertissement_id: "a1",
    });
  });
});
