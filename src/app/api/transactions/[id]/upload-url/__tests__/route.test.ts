import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

// Only getSignedUploadUrl (the actual AWS-calling function) is faked --
// checkUploadSize()/maxUploadSizeBytes() stay real, already covered
// directly and in isolation by r2.test.ts, so this test exercises the
// genuine size-cap logic rather than a hand-duplicated mock of it.
vi.mock("@/lib/r2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/r2")>();
  return {
    ...actual,
    getSignedUploadUrl: vi.fn(async () => "https://r2.example/signed-put-url"),
  };
});

import { getSignedUploadUrl } from "@/lib/r2";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function buildSupabase(user: { id: string } | null, transaction: Record<string, unknown> | null) {
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: transaction, error: transaction ? null : { message: "not found" } }),
        }),
      }),
    }),
  };
}

function buildRequest(id: string, body: Record<string, unknown>) {
  return {
    request: new Request(`http://localhost/api/transactions/${id}/upload-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: Promise.resolve({ id }),
  };
}

describe("POST /api/transactions/[id]/upload-url", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validTransaction = {
    id: "tx-1",
    createur_id: "u1",
    statut: "validee",
    offres: { type: "video" },
  };

  it("rejects a size over the real server-side cap -- not just a client-side check", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, validTransaction) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/transactions/[id]/upload-url/route");
    const { request, params } = buildRequest("tx-1", { size: 300 * 1024 * 1024 });
    const response = await POST(request as never, { params });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/volumineux/i);
    // The real point of this fix: an oversized upload never even gets a
    // signed URL minted for it -- rejected before getSignedUploadUrl is
    // ever called, not just relying on a client-side check the caller
    // could skip by hitting this route directly.
    expect(getSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("rejects a missing/zero size the same way", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, validTransaction) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/transactions/[id]/upload-url/route");
    const { request, params } = buildRequest("tx-1", {});
    const response = await POST(request as never, { params });

    expect(response.status).toBe(400);
    expect(getSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("mints a signed URL for a valid, in-bounds size", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, validTransaction) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/transactions/[id]/upload-url/route");
    const { request, params } = buildRequest("tx-1", { size: 10 * 1024 * 1024 });
    const response = await POST(request as never, { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.uploadUrl).toBe("https://r2.example/signed-put-url");
    expect(getSignedUploadUrl).toHaveBeenCalledWith(
      expect.stringMatching(/^videos\/tx-1\//),
      "video/mp4",
      10 * 1024 * 1024,
    );
  });
});
