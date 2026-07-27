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
  return new Request("http://localhost/api/admin/traiter-retrait", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/traiter-retrait", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an unauthenticated request", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(null, null) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/admin/traiter-retrait/route");
    const response = await POST(buildRequest({ id: "d-1", decision: "traite" }) as never);

    expect(response.status).toBe(401);
  });

  it("requires both id and decision", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, null) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/admin/traiter-retrait/route");
    const response = await POST(buildRequest({ id: "d-1" }) as never);

    expect(response.status).toBe(400);
  });

  it("surfaces the RPC's rejection (e.g. caller isn't admin) as a 403", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, { message: "not authorized" }) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/admin/traiter-retrait/route");
    const response = await POST(buildRequest({ id: "d-1", decision: "refuse" }) as never);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("not authorized");
  });

  it("passes id/decision/note through to traiter_retrait, trimming a blank note to null", async () => {
    const rpcSpy = vi.fn();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, null, rpcSpy) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/admin/traiter-retrait/route");
    const response = await POST(
      buildRequest({ id: "d-1", decision: "traite", note: "  viré le 27/07  " }) as never,
    );

    expect(response.status).toBe(200);
    expect(rpcSpy).toHaveBeenCalledWith("traiter_retrait", {
      p_id: "d-1",
      p_decision: "traite",
      p_note: "viré le 27/07",
    });
  });

  it("sends null when no note is provided", async () => {
    const rpcSpy = vi.fn();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, null, rpcSpy) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/admin/traiter-retrait/route");
    await POST(buildRequest({ id: "d-1", decision: "refuse" }) as never);

    expect(rpcSpy).toHaveBeenCalledWith("traiter_retrait", {
      p_id: "d-1",
      p_decision: "refuse",
      p_note: null,
    });
  });
});
