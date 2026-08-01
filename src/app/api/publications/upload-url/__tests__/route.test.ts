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

function buildSupabase(user: { id: string } | null, profil: Record<string, unknown> | null) {
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: profil }),
        }),
      }),
    }),
  };
}

function buildRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/publications/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/publications/upload-url", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an image over the real server-side size cap, before minting any URL", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, { createur_verifie: true }) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/publications/upload-url/route");
    const response = await POST(
      buildRequest({ contentType: "image/jpeg", size: MAX_UPLOAD_SIZE_BYTES.image + 1 }) as never,
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/volumineux/i);
    expect(getSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("mints a signed URL for a valid, in-bounds image size", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, { createur_verifie: true }) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/publications/upload-url/route");
    const response = await POST(buildRequest({ contentType: "image/jpeg", size: 1024 }) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.uploadUrl).toBe("https://r2.example/signed-put-url");
    expect(getSignedUploadUrl).toHaveBeenCalledWith(
      expect.stringMatching(/^publications\/u1\//),
      "image/jpeg",
      1024,
    );
  });

  it("mints a signed URL for a valid, in-bounds video size", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, { createur_verifie: true }) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/publications/upload-url/route");
    const response = await POST(buildRequest({ contentType: "video/mp4", size: 1024 }) as never);

    expect(response.status).toBe(200);
    expect(getSignedUploadUrl).toHaveBeenCalledWith(
      expect.stringMatching(/^publications\/u1\//),
      "video/mp4",
      1024,
    );
  });

  it("rejects a video over the real server-side size cap, before minting any URL", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, { createur_verifie: true }) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/publications/upload-url/route");
    const response = await POST(
      buildRequest({ contentType: "video/mp4", size: MAX_UPLOAD_SIZE_BYTES.video + 1 }) as never,
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/volumineux/i);
    expect(getSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("rejects a content type that's neither an image nor a video", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }, { createur_verifie: true }) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/publications/upload-url/route");
    const response = await POST(
      buildRequest({ contentType: "application/pdf", size: 1024 }) as never,
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/images et vidéos/i);
    expect(getSignedUploadUrl).not.toHaveBeenCalled();
  });
});
