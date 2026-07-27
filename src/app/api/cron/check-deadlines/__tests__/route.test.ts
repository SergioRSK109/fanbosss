import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));
vi.mock("@/lib/refunds", () => ({
  processAutomaticRefund: vi.fn(),
}));

import { processAutomaticRefund } from "@/lib/refunds";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

const CRON_SECRET = "test-cron-secret";
process.env.CRON_SECRET = CRON_SECRET;

function buildRequest(authHeader?: string) {
  return new Request("http://localhost/api/cron/check-deadlines", {
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

describe("GET /api/cron/check-deadlines", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a request without the correct bearer secret, before touching the DB", async () => {
    const { GET } = await import("@/app/api/cron/check-deadlines/route");
    const response = await GET(buildRequest("Bearer wrong-secret") as never);

    expect(response.status).toBe(401);
    expect(createSupabaseServiceRoleClient).not.toHaveBeenCalled();
    expect(processAutomaticRefund).not.toHaveBeenCalled();
  });

  it("does not attempt any refund if the RPC itself errors, and never reaches close_expired_campagnes", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "boom" } }));
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue({
      rpc,
    } as unknown as ReturnType<typeof createSupabaseServiceRoleClient>);

    const { GET } = await import("@/app/api/cron/check-deadlines/route");
    const response = await GET(buildRequest(`Bearer ${CRON_SECRET}`) as never);

    expect(response.status).toBe(500);
    expect(processAutomaticRefund).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("process_transaction_deadlines");
  });

  it("attempts an automatic refund for every transaction the deadline sweep just refunded", async () => {
    const rows = [
      { transaction_id: "tx-1", reason: "deadline_acceptation_depassee" },
      { transaction_id: "tx-2", reason: "deadline_livraison_depassee" },
    ];
    const serviceClient = {
      rpc: vi.fn(async (name: string) =>
        name === "process_transaction_deadlines"
          ? { data: rows, error: null }
          : { data: [], error: null },
      ),
    };
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(
      serviceClient as unknown as ReturnType<typeof createSupabaseServiceRoleClient>,
    );

    const { GET } = await import("@/app/api/cron/check-deadlines/route");
    const response = await GET(buildRequest(`Bearer ${CRON_SECRET}`) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.refunded).toEqual(rows);
    expect(processAutomaticRefund).toHaveBeenCalledTimes(2);
    expect(processAutomaticRefund).toHaveBeenNthCalledWith(1, serviceClient, "tx-1");
    expect(processAutomaticRefund).toHaveBeenNthCalledWith(2, serviceClient, "tx-2");
  });

  it("also closes expired campagnes and includes them in the response", async () => {
    const closedCampagnes = [{ offre_id: "campagne-1" }];
    const serviceClient = {
      rpc: vi.fn(async (name: string) =>
        name === "close_expired_campagnes"
          ? { data: closedCampagnes, error: null }
          : { data: [], error: null },
      ),
    };
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(
      serviceClient as unknown as ReturnType<typeof createSupabaseServiceRoleClient>,
    );

    const { GET } = await import("@/app/api/cron/check-deadlines/route");
    const response = await GET(buildRequest(`Bearer ${CRON_SECRET}`) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.campagnesClosed).toEqual(closedCampagnes);
    expect(serviceClient.rpc).toHaveBeenCalledWith("close_expired_campagnes");
  });

  it("returns a 500 if close_expired_campagnes errors, even though the deadline sweep already succeeded", async () => {
    const serviceClient = {
      rpc: vi.fn(async (name: string) =>
        name === "close_expired_campagnes"
          ? { data: null, error: { message: "campagnes boom" } }
          : { data: [], error: null },
      ),
    };
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(
      serviceClient as unknown as ReturnType<typeof createSupabaseServiceRoleClient>,
    );

    const { GET } = await import("@/app/api/cron/check-deadlines/route");
    const response = await GET(buildRequest(`Bearer ${CRON_SECRET}`) as never);

    expect(response.status).toBe(500);
  });

  // Lot 2a: fan-confirmation-deadline sweep (auto-confirm after 72h of
  // silence) -- a third RPC call, same shape as close_expired_campagnes
  // above, deliberately never routed through processAutomaticRefund()
  // since an auto-confirmed transaction never becomes 'remboursee'.
  it("also auto-confirms transactions past their fan-confirmation deadline and includes them in the response", async () => {
    const confirmedByDeadline = [{ transaction_id: "tx-video-1" }];
    const serviceClient = {
      rpc: vi.fn(async (name: string) =>
        name === "process_confirmation_deadlines"
          ? { data: confirmedByDeadline, error: null }
          : { data: [], error: null },
      ),
    };
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(
      serviceClient as unknown as ReturnType<typeof createSupabaseServiceRoleClient>,
    );

    const { GET } = await import("@/app/api/cron/check-deadlines/route");
    const response = await GET(buildRequest(`Bearer ${CRON_SECRET}`) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.confirmedByDeadline).toEqual(confirmedByDeadline);
    expect(serviceClient.rpc).toHaveBeenCalledWith("process_confirmation_deadlines");
    expect(processAutomaticRefund).not.toHaveBeenCalled();
  });

  it("returns a 500 if process_confirmation_deadlines errors, even though everything before it already succeeded", async () => {
    const serviceClient = {
      rpc: vi.fn(async (name: string) =>
        name === "process_confirmation_deadlines"
          ? { data: null, error: { message: "confirmation sweep boom" } }
          : { data: [], error: null },
      ),
    };
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(
      serviceClient as unknown as ReturnType<typeof createSupabaseServiceRoleClient>,
    );

    const { GET } = await import("@/app/api/cron/check-deadlines/route");
    const response = await GET(buildRequest(`Bearer ${CRON_SECRET}`) as never);

    expect(response.status).toBe(500);
  });
});
