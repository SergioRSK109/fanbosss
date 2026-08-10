import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

// Only getSignedUploadUrl (the actual AWS-calling function) is faked --
// checkUploadSize()/maxUploadSizeBytes() stay real, already covered
// directly and in isolation by r2.test.ts. Same pattern as
// offres/[id]/image-upload-url's own test.
vi.mock("@/lib/r2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/r2")>();
  return {
    ...actual,
    getSignedUploadUrl: vi.fn(async () => "https://r2.example/signed-put-url"),
  };
});

import { getSignedUploadUrl, MAX_UPLOAD_SIZE_BYTES } from "@/lib/r2";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function buildSupabase(user: { id: string } | null, concours: Record<string, unknown> | null) {
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: concours, error: concours ? null : { message: "not found" } }),
        }),
      }),
    }),
  };
}

function buildRequest(id: string, body: Record<string, unknown>) {
  return {
    request: new Request(`http://localhost/api/concours/${id}/trophee-upload-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: Promise.resolve({ id }),
  };
}

const concoursOwnedByU1 = { id: "concours-1", organisateur_id: "u1" };

describe("POST /api/concours/[id]/trophee-upload-url", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an unauthenticated caller", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(null, concoursOwnedByU1) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/concours/[id]/trophee-upload-url/route");
    const { request, params } = buildRequest("concours-1", { contentType: "image/jpeg", size: 1024 });
    const response = await POST(request as never, { params });

    expect(response.status).toBe(401);
    expect(getSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("404s when the concours isn't found (or isn't readable by the caller)", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, null) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/concours/[id]/trophee-upload-url/route");
    const { request, params } = buildRequest("concours-1", { contentType: "image/jpeg", size: 1024 });
    const response = await POST(request as never, { params });

    expect(response.status).toBe(404);
    expect(getSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("rejects a non-organizer", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "someone-else" }, concoursOwnedByU1) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/concours/[id]/trophee-upload-url/route");
    const { request, params } = buildRequest("concours-1", { contentType: "image/jpeg", size: 1024 });
    const response = await POST(request as never, { params });

    expect(response.status).toBe(403);
    expect(getSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("rejects a non-image content type", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, concoursOwnedByU1) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/concours/[id]/trophee-upload-url/route");
    const { request, params } = buildRequest("concours-1", { contentType: "video/mp4", size: 1024 });
    const response = await POST(request as never, { params });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/images/i);
    expect(getSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("rejects an image over the real server-side size cap, before minting any URL", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, concoursOwnedByU1) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/concours/[id]/trophee-upload-url/route");
    const { request, params } = buildRequest("concours-1", {
      contentType: "image/jpeg",
      size: MAX_UPLOAD_SIZE_BYTES.image + 1,
    });
    const response = await POST(request as never, { params });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/volumineux/i);
    expect(getSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("mints a signed URL for a valid, in-bounds image on a concours owned by the caller", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, concoursOwnedByU1) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/concours/[id]/trophee-upload-url/route");
    const { request, params } = buildRequest("concours-1", { contentType: "image/jpeg", size: 1024 });
    const response = await POST(request as never, { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.uploadUrl).toBe("https://r2.example/signed-put-url");
    expect(getSignedUploadUrl).toHaveBeenCalledWith(
      expect.stringMatching(/^concours\/concours-1\//),
      "image/jpeg",
      1024,
    );
  });
});
