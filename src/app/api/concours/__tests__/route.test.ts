import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";

function buildSupabase(
  user: { id: string } | null,
  rpcResult: { data: unknown; error: { message: string } | null },
) {
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    rpc: async () => rpcResult,
  };
}

function buildRequest(body: unknown) {
  return new Request("http://localhost/api/concours", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  nom: "Concours de la rentrée",
  dateFin: new Date(Date.now() + 86400000).toISOString(),
  campagneId: "11111111-1111-4111-8111-111111111111",
};

describe("POST /api/concours", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an unauthenticated request", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(null, { data: null, error: null }) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/concours/route");
    const response = await POST(buildRequest(VALID_BODY) as never);

    expect(response.status).toBe(401);
  });

  it("rejects a malformed body (invalid campagneId) with 400 before calling the RPC", async () => {
    const supabase = buildSupabase({ id: "u1" }, { data: null, error: null });
    const rpcSpy = vi.spyOn(supabase, "rpc");
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/concours/route");
    const response = await POST(buildRequest({ ...VALID_BODY, campagneId: "not-a-uuid" }) as never);

    expect(response.status).toBe(400);
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("surfaces the RPC's own rejection (e.g. ownership violation) as a 400", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(
        { id: "u1" },
        { data: null, error: { message: "not authorized: you can only use your own campaign" } },
      ) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/concours/route");
    const response = await POST(buildRequest(VALID_BODY) as never);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("not authorized: you can only use your own campaign");
  });

  it("returns the new concours id once the RPC succeeds", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(
        { id: "u1" },
        { data: "22222222-2222-4222-8222-222222222222", error: null },
      ) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/concours/route");
    const response = await POST(buildRequest(VALID_BODY) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe("22222222-2222-4222-8222-222222222222");
  });
});
