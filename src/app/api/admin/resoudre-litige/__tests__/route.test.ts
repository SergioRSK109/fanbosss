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
  return new Request("http://localhost/api/admin/resoudre-litige", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/resoudre-litige", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an unauthenticated request", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(null, null) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/admin/resoudre-litige/route");
    const response = await POST(
      buildRequest({ transactionId: "tx-1", decision: "faveur_createur" }) as never,
    );

    expect(response.status).toBe(401);
  });

  it("requires both transactionId and decision", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, null) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/admin/resoudre-litige/route");
    const response = await POST(buildRequest({ transactionId: "tx-1" }) as never);

    expect(response.status).toBe(400);
  });

  it("surfaces the RPC's rejection (e.g. caller isn't admin, or already resolved) as a 403", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, { message: "not authorized" }) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/admin/resoudre-litige/route");
    const response = await POST(
      buildRequest({ transactionId: "tx-1", decision: "faveur_fan" }) as never,
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("not authorized");
  });

  it("passes transactionId/decision/note through to resoudre_litige, trimming a blank note to null", async () => {
    const rpcSpy = vi.fn();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, null, rpcSpy) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/admin/resoudre-litige/route");
    const response = await POST(
      buildRequest({
        transactionId: "tx-1",
        decision: "faveur_createur",
        note: "  vidéo conforme  ",
      }) as never,
    );

    expect(response.status).toBe(200);
    expect(rpcSpy).toHaveBeenCalledWith("resoudre_litige", {
      p_transaction_id: "tx-1",
      p_decision: "faveur_createur",
      p_note: "vidéo conforme",
    });
  });

  it("sends null when no note is provided", async () => {
    const rpcSpy = vi.fn();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, null, rpcSpy) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/admin/resoudre-litige/route");
    await POST(buildRequest({ transactionId: "tx-1", decision: "faveur_fan" }) as never);

    expect(rpcSpy).toHaveBeenCalledWith("resoudre_litige", {
      p_transaction_id: "tx-1",
      p_decision: "faveur_fan",
      p_note: null,
    });
  });
});
