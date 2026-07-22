import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock("@/lib/r2", () => ({
  getSignedDownloadUrl: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSignedDownloadUrl } from "@/lib/r2";

function buildSupabase(user: { id: string } | null, transaction: Record<string, unknown> | null) {
  return {
    auth: {
      getUser: async () => ({ data: { user } }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: transaction,
            error: transaction ? null : { message: "not found" },
          }),
        }),
      }),
    }),
  };
}

function buildRequest(id: string) {
  return {
    request: new Request(`http://localhost/api/transactions/${id}/video-url`),
    params: Promise.resolve({ id }),
  };
}

describe("GET /api/transactions/[id]/video-url (brief 0.5: signed, authenticated, expiring delivery)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an unauthenticated request before touching R2", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(null, null) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { GET } = await import("@/app/api/transactions/[id]/video-url/route");
    const { request, params } = buildRequest("tx-1");
    const response = await GET(request as never, { params });

    expect(response.status).toBe(401);
    expect(getSignedDownloadUrl).not.toHaveBeenCalled();
  });

  it("rejects when the authenticated user is not the transaction's fan (no signed URL leaks)", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(
        { id: "someone-else" },
        { id: "tx-1", fan_id: "the-actual-fan", statut: "livree", livrable: { r2_key: "videos/tx-1/a.mp4" } },
      ) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { GET } = await import("@/app/api/transactions/[id]/video-url/route");
    const { request, params } = buildRequest("tx-1");
    const response = await GET(request as never, { params });

    expect(response.status).toBe(403);
    expect(getSignedDownloadUrl).not.toHaveBeenCalled();
  });

  it("rejects when the video has not been marked livree yet, even for the correct fan", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(
        { id: "fan-1" },
        { id: "tx-1", fan_id: "fan-1", statut: "validee", livrable: {} },
      ) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { GET } = await import("@/app/api/transactions/[id]/video-url/route");
    const { request, params } = buildRequest("tx-1");
    const response = await GET(request as never, { params });

    expect(response.status).toBe(403);
    expect(getSignedDownloadUrl).not.toHaveBeenCalled();
  });

  it("returns a short-lived signed URL only for the correct, delivered fan", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(
        { id: "fan-1" },
        { id: "tx-1", fan_id: "fan-1", statut: "livree", livrable: { r2_key: "videos/tx-1/a.mp4" } },
      ) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );
    vi.mocked(getSignedDownloadUrl).mockResolvedValue("https://r2.example/signed?exp=123");

    const { GET } = await import("@/app/api/transactions/[id]/video-url/route");
    const { request, params } = buildRequest("tx-1");
    const response = await GET(request as never, { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.url).toBe("https://r2.example/signed?exp=123");
    expect(body.expiresInSeconds).toBe(3600);
    expect(getSignedDownloadUrl).toHaveBeenCalledWith("videos/tx-1/a.mp4");
  });
});
