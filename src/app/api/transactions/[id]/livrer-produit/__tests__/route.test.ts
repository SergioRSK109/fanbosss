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

function buildRequest(id: string, body: Record<string, unknown> = {}) {
  return {
    request: new Request(`http://localhost/api/transactions/${id}/livrer-produit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: Promise.resolve({ id }),
  };
}

describe("POST /api/transactions/[id]/livrer-produit", () => {
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

    const { POST } = await import("@/app/api/transactions/[id]/livrer-produit/route");
    const { request, params } = buildRequest("tx-1", { referenceSuivi: "DHL-1" });
    const response = await POST(request as never, { params });

    expect(response.status).toBe(401);
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("surfaces a 400 when livrer_produit itself rejects the call", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(
        { id: "u1" },
        { message: "transaction has not reached validee yet" },
      ) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/transactions/[id]/livrer-produit/route");
    const { request, params } = buildRequest("tx-1");
    const response = await POST(request as never, { params });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("transaction has not reached validee yet");
  });

  it("calls livrer_produit with the transaction id and the tracking reference on success", async () => {
    const rpcSpy = vi.fn();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, null, rpcSpy) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/transactions/[id]/livrer-produit/route");
    const { request, params } = buildRequest("tx-1", { referenceSuivi: "  DHL-98765  " });
    const response = await POST(request as never, { params });

    expect(response.status).toBe(200);
    expect(rpcSpy).toHaveBeenCalledWith("livrer_produit", {
      p_transaction_id: "tx-1",
      p_reference_suivi: "DHL-98765",
    });
  });

  it("passes null (never an empty string) when no tracking reference is given -- genuinely optional", async () => {
    const rpcSpy = vi.fn();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, null, rpcSpy) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/transactions/[id]/livrer-produit/route");
    const { request, params } = buildRequest("tx-1", {});
    const response = await POST(request as never, { params });

    expect(response.status).toBe(200);
    expect(rpcSpy).toHaveBeenCalledWith("livrer_produit", {
      p_transaction_id: "tx-1",
      p_reference_suivi: null,
    });
  });
});
