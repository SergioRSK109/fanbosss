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
  return new Request("http://localhost/api/admin/emettre-avertissement", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/emettre-avertissement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an unauthenticated request", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(null, null) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/admin/emettre-avertissement/route");
    const response = await POST(buildRequest({ userId: "u2", raison: "spam" }) as never);

    expect(response.status).toBe(401);
  });

  it("requires userId", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, null) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/admin/emettre-avertissement/route");
    const response = await POST(buildRequest({ raison: "spam" }) as never);

    expect(response.status).toBe(400);
  });

  it("requires a non-blank raison -- unlike suspendre/bannir, this one is mandatory", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, null) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/admin/emettre-avertissement/route");

    const missing = await POST(buildRequest({ userId: "u2" }) as never);
    expect(missing.status).toBe(400);

    const blank = await POST(buildRequest({ userId: "u2", raison: "   " }) as never);
    expect(blank.status).toBe(400);
  });

  it("surfaces the RPC's rejection (e.g. caller isn't admin) as a 403", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, { message: "not authorized" }) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/admin/emettre-avertissement/route");
    const response = await POST(buildRequest({ userId: "u2", raison: "spam" }) as never);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("not authorized");
  });

  it("passes userId and a trimmed raison through to emettre_avertissement", async () => {
    const rpcSpy = vi.fn();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, null, rpcSpy) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/admin/emettre-avertissement/route");
    const response = await POST(
      buildRequest({ userId: "u2", raison: "  Contenu limite, à surveiller  " }) as never,
    );

    expect(response.status).toBe(200);
    expect(rpcSpy).toHaveBeenCalledWith("emettre_avertissement", {
      p_user_id: "u2",
      p_raison: "Contenu limite, à surveiller",
    });
  });
});
