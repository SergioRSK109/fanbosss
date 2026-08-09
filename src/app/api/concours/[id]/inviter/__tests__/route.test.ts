import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";

function buildSupabase(
  user: { id: string } | null,
  matchRow: { id: string } | null,
  rpcResult: { error: { message: string } | null },
  selectSpy: (columns: string) => void = () => {},
) {
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => ({
      select: (columns: string) => {
        selectSpy(columns);
        return {
          ilike: () => ({
            maybeSingle: async () => ({ data: matchRow }),
          }),
        };
      },
    }),
    rpc: async () => rpcResult,
  };
}

function buildRequest(id: string, body: unknown) {
  return {
    request: new Request(`http://localhost/api/concours/${id}/inviter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: Promise.resolve({ id }),
  };
}

describe("POST /api/concours/[id]/inviter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an unauthenticated request", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(null, null, { error: null }) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/concours/[id]/inviter/route");
    const { request, params } = buildRequest("c1", { pseudo: "sergio" });
    const response = await POST(request as never, { params });

    expect(response.status).toBe(401);
  });

  it("requires a non-empty pseudo", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, null, { error: null }) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/concours/[id]/inviter/route");
    const { request, params } = buildRequest("c1", { pseudo: "" });
    const response = await POST(request as never, { params });

    expect(response.status).toBe(400);
  });

  it("returns 404 when no créateur matches the given pseudo, never calling the RPC", async () => {
    const supabase = buildSupabase({ id: "u1" }, null, { error: null });
    const rpcSpy = vi.spyOn(supabase, "rpc");
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/concours/[id]/inviter/route");
    const { request, params } = buildRequest("c1", { pseudo: "inconnu" });
    const response = await POST(request as never, { params });

    expect(response.status).toBe(404);
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("resolves a leading @ the same way it resolves a plain pseudo", async () => {
    const selectSpy = vi.fn();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(
        { id: "u1" },
        { id: "invited-user" },
        { error: null },
        selectSpy,
      ) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/concours/[id]/inviter/route");
    const { request, params } = buildRequest("c1", { pseudo: "@sergio" });
    const response = await POST(request as never, { params });

    expect(response.status).toBe(200);
    expect(selectSpy).toHaveBeenCalledWith("id");
  });

  it("surfaces the RPC's own rejection (e.g. non-organizer caller) as a 400", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(
        { id: "u1" },
        { id: "invited-user" },
        { error: { message: "not authorized: only the concours organizer can invite participants" } },
      ) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/concours/[id]/inviter/route");
    const { request, params } = buildRequest("c1", { pseudo: "sergio" });
    const response = await POST(request as never, { params });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("not authorized: only the concours organizer can invite participants");
  });

  it("returns ok once the RPC succeeds with the resolved id", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, { id: "invited-user" }, { error: null }) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/concours/[id]/inviter/route");
    const { request, params } = buildRequest("c1", { pseudo: "sergio" });
    const response = await POST(request as never, { params });

    expect(response.status).toBe(200);
  });
});
