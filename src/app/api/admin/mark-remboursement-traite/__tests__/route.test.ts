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

function buildRequest(body: unknown) {
  return new Request("http://localhost/api/admin/mark-remboursement-traite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/mark-remboursement-traite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an unauthenticated request", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(null, null) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/admin/mark-remboursement-traite/route");
    const response = await POST(buildRequest({ transactionId: "tx-1" }) as never);

    expect(response.status).toBe(401);
  });

  it("requires transactionId", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, null) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/admin/mark-remboursement-traite/route");
    const response = await POST(buildRequest({}) as never);

    expect(response.status).toBe(400);
  });

  it("surfaces the RPC's rejection (e.g. caller isn't admin) as a 403", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, { message: "not authorized" }) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/admin/mark-remboursement-traite/route");
    const response = await POST(buildRequest({ transactionId: "tx-1" }) as never);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("not authorized");
  });

  it("returns ok once the RPC succeeds", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, null) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/admin/mark-remboursement-traite/route");
    const response = await POST(buildRequest({ transactionId: "tx-1" }) as never);

    expect(response.status).toBe(200);
  });
});
