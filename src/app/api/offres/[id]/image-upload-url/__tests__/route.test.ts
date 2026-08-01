import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

// Only getSignedUploadUrl (the actual AWS-calling function) is faked --
// checkUploadSize()/maxUploadSizeBytes() stay real, already covered
// directly and in isolation by r2.test.ts.
vi.mock("@/lib/r2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/r2")>();
  return {
    ...actual,
    getSignedUploadUrl: vi.fn(async () => "https://r2.example/signed-put-url"),
  };
});

import { getSignedUploadUrl, MAX_UPLOAD_SIZE_BYTES } from "@/lib/r2";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function buildSupabase(user: { id: string } | null, offre: Record<string, unknown> | null) {
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: offre, error: offre ? null : { message: "not found" } }),
        }),
      }),
    }),
  };
}

function buildRequest(id: string, body: Record<string, unknown>) {
  return {
    request: new Request(`http://localhost/api/offres/${id}/image-upload-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: Promise.resolve({ id }),
  };
}

const produitOffre = { id: "offre-1", type: "produit", createur_id: "u1" };

describe("POST /api/offres/[id]/image-upload-url", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an unauthenticated caller", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(null, produitOffre) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/offres/[id]/image-upload-url/route");
    const { request, params } = buildRequest("offre-1", { contentType: "image/jpeg", size: 1024 });
    const response = await POST(request as never, { params });

    expect(response.status).toBe(401);
    expect(getSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("rejects a non-owner", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "someone-else" }, produitOffre) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/offres/[id]/image-upload-url/route");
    const { request, params } = buildRequest("offre-1", { contentType: "image/jpeg", size: 1024 });
    const response = await POST(request as never, { params });

    expect(response.status).toBe(403);
    expect(getSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("rejects an offre that is not of type produit", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, { id: "offre-1", type: "video", createur_id: "u1" }) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/offres/[id]/image-upload-url/route");
    const { request, params } = buildRequest("offre-1", { contentType: "image/jpeg", size: 1024 });
    const response = await POST(request as never, { params });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/produit/i);
    expect(getSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("rejects a non-image content type", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, produitOffre) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/offres/[id]/image-upload-url/route");
    const { request, params } = buildRequest("offre-1", { contentType: "video/mp4", size: 1024 });
    const response = await POST(request as never, { params });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/images/i);
    expect(getSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("rejects an image over the real server-side size cap, before minting any URL", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, produitOffre) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/offres/[id]/image-upload-url/route");
    const { request, params } = buildRequest("offre-1", {
      contentType: "image/jpeg",
      size: MAX_UPLOAD_SIZE_BYTES.image + 1,
    });
    const response = await POST(request as never, { params });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/volumineux/i);
    expect(getSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("mints a signed URL for a valid, in-bounds image on a produit offre owned by the caller", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, produitOffre) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/offres/[id]/image-upload-url/route");
    const { request, params } = buildRequest("offre-1", { contentType: "image/jpeg", size: 1024 });
    const response = await POST(request as never, { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.uploadUrl).toBe("https://r2.example/signed-put-url");
    expect(getSignedUploadUrl).toHaveBeenCalledWith(
      expect.stringMatching(/^offres\/offre-1\//),
      "image/jpeg",
      1024,
    );
  });
});
