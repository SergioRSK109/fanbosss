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
    request: new Request(`http://localhost/api/transactions/${id}/confirm`, { method: "POST" }),
    params: Promise.resolve({ id }),
  };
}

describe("POST /api/transactions/[id]/confirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an unauthenticated request without ever calling the RPC", async () => {
    const rpcSpy = vi.fn();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(null, null, rpcSpy) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/transactions/[id]/confirm/route");
    const { request, params } = buildRequest("tx-1");
    const response = await POST(request as never, { params });

    expect(response.status).toBe(401);
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("surfaces a 400 when confirmer_livraison_fan itself rejects the call", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(
        { id: "u1" },
        { message: "transaction is not awaiting fan confirmation" },
      ) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/transactions/[id]/confirm/route");
    const { request, params } = buildRequest("tx-1");
    const response = await POST(request as never, { params });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("transaction is not awaiting fan confirmation");
  });

  it("calls confirmer_livraison_fan with the transaction id on success", async () => {
    const rpcSpy = vi.fn();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, null, rpcSpy) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/transactions/[id]/confirm/route");
    const { request, params } = buildRequest("tx-1");
    const response = await POST(request as never, { params });

    expect(response.status).toBe(200);
    expect(rpcSpy).toHaveBeenCalledWith("confirmer_livraison_fan", {
      p_transaction_id: "tx-1",
    });
  });
});
