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
  return new Request("http://localhost/api/wallet/demander-retrait", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/wallet/demander-retrait", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an unauthenticated request", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(null, null) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/wallet/demander-retrait/route");
    const response = await POST(buildRequest({ montant: 50 }) as never);

    expect(response.status).toBe(401);
  });

  it("requires a numeric montant", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, null) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/wallet/demander-retrait/route");
    const response = await POST(buildRequest({}) as never);

    expect(response.status).toBe(400);
  });

  it("surfaces the RPC's rejection (e.g. under the $25 minimum, or over the real balance) as a 400", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(
        { id: "u1" },
        { message: "le montant minimum de retrait est 25$" },
      ) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/wallet/demander-retrait/route");
    const response = await POST(buildRequest({ montant: 10 }) as never);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("le montant minimum de retrait est 25$");
  });

  it("passes montant through to demander_retrait", async () => {
    const rpcSpy = vi.fn();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, null, rpcSpy) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/wallet/demander-retrait/route");
    const response = await POST(buildRequest({ montant: 42 }) as never);

    expect(response.status).toBe(200);
    expect(rpcSpy).toHaveBeenCalledWith("demander_retrait", { p_montant: 42 });
  });
});
