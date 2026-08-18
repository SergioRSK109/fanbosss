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

import { getSignedUploadUrl } from "@/lib/r2";
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
    request: new Request(`http://localhost/api/offres/${id}/content-upload-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: Promise.resolve({ id }),
  };
}

const contenuDebloqueOffre = { id: "offre-1", type: "contenu_debloque", createur_id: "u1" };

describe("POST /api/offres/[id]/content-upload-url", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an unauthenticated caller", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(null, contenuDebloqueOffre) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/offres/[id]/content-upload-url/route");
    const { request, params } = buildRequest("offre-1", { contentType: "image/jpeg", size: 1024 });
    const response = await POST(request as never, { params });

    expect(response.status).toBe(401);
    expect(getSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("rejects a non-owner", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "someone-else" }, contenuDebloqueOffre) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/offres/[id]/content-upload-url/route");
    const { request, params } = buildRequest("offre-1", { contentType: "image/jpeg", size: 1024 });
    const response = await POST(request as never, { params });

    expect(response.status).toBe(403);
    expect(getSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("rejects an offre that is not of type contenu_debloque", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, { id: "offre-1", type: "video", createur_id: "u1" }) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/offres/[id]/content-upload-url/route");
    const { request, params } = buildRequest("offre-1", { contentType: "image/jpeg", size: 1024 });
    const response = await POST(request as never, { params });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/contenu_debloque/i);
    expect(getSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("appends the recognized media extension to the r2_key for a known image content type", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, contenuDebloqueOffre) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/offres/[id]/content-upload-url/route");
    const { request, params } = buildRequest("offre-1", { contentType: "image/jpeg", size: 1024 });
    const response = await POST(request as never, { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.r2Key).toMatch(/^offres\/offre-1\/[^/]+\.jpg$/);
    expect(getSignedUploadUrl).toHaveBeenCalledWith(body.r2Key, "image/jpeg", 1024);
  });

  it("appends the recognized media extension to the r2_key for a known video content type", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, contenuDebloqueOffre) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/offres/[id]/content-upload-url/route");
    const { request, params } = buildRequest("offre-1", { contentType: "video/mp4", size: 1024 });
    const response = await POST(request as never, { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.r2Key).toMatch(/^offres\/offre-1\/[^/]+\.mp4$/);
  });

  it("appends the recognized media extension to the r2_key for a known audio content type", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, contenuDebloqueOffre) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/offres/[id]/content-upload-url/route");
    const { request, params } = buildRequest("offre-1", { contentType: "audio/mpeg", size: 1024 });
    const response = await POST(request as never, { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.r2Key).toMatch(/^offres\/offre-1\/[^/]+\.mp3$/);
  });

  it("leaves the r2_key exactly as today (no extension) for a non-media content type -- no regression on PDF/ZIP sales", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, contenuDebloqueOffre) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/offres/[id]/content-upload-url/route");
    const { request, params } = buildRequest("offre-1", { contentType: "application/pdf", size: 1024 });
    const response = await POST(request as never, { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.r2Key).toMatch(/^offres\/offre-1\/[^/.]+$/);
    expect(getSignedUploadUrl).toHaveBeenCalledWith(body.r2Key, "application/pdf", 1024);
  });

  it("leaves the r2_key exactly as today (no extension) when contentType is omitted", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, contenuDebloqueOffre) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/offres/[id]/content-upload-url/route");
    const { request, params } = buildRequest("offre-1", { size: 1024 });
    const response = await POST(request as never, { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.r2Key).toMatch(/^offres\/offre-1\/[^/.]+$/);
  });
});
