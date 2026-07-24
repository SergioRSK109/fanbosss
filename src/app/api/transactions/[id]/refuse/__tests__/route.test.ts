import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
  createSupabaseServiceRoleClient: vi.fn(),
}));
vi.mock("@/lib/refunds", () => ({
  processAutomaticRefund: vi.fn(),
}));

import { processAutomaticRefund } from "@/lib/refunds";
import {
  createSupabaseServerClient,
  createSupabaseServiceRoleClient,
} from "@/lib/supabase/server";

function buildSupabase(user: { id: string } | null, rpcError: { message: string } | null) {
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    rpc: async () => ({ error: rpcError }),
  };
}

function buildRequest(id: string) {
  return {
    request: new Request(`http://localhost/api/transactions/${id}/refuse`, { method: "POST" }),
    params: Promise.resolve({ id }),
  };
}

describe("POST /api/transactions/[id]/refuse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an unauthenticated request without attempting a refund", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(null, null) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/transactions/[id]/refuse/route");
    const { request, params } = buildRequest("tx-1");
    const response = await POST(request as never, { params });

    expect(response.status).toBe(401);
    expect(processAutomaticRefund).not.toHaveBeenCalled();
  });

  it("does not attempt a refund if refuse_transaction itself fails", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, { message: "not authorized" }) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/transactions/[id]/refuse/route");
    const { request, params } = buildRequest("tx-1");
    const response = await POST(request as never, { params });

    expect(response.status).toBe(400);
    expect(processAutomaticRefund).not.toHaveBeenCalled();
  });

  it("attempts the automatic refund (via the service-role client) once refuse_transaction succeeds", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, null) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );
    const serviceClient = { marker: "service-role" };
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(
      serviceClient as unknown as ReturnType<typeof createSupabaseServiceRoleClient>,
    );

    const { POST } = await import("@/app/api/transactions/[id]/refuse/route");
    const { request, params } = buildRequest("tx-1");
    const response = await POST(request as never, { params });

    expect(response.status).toBe(200);
    expect(processAutomaticRefund).toHaveBeenCalledWith(serviceClient, "tx-1");
  });
});
