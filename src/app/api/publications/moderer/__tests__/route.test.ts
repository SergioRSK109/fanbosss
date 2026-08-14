import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/r2", () => ({
  getObjectBase64: vi.fn(),
}));

vi.mock("@/lib/moderation", () => ({
  moderatePublication: vi.fn(),
}));

import { getObjectBase64 } from "@/lib/r2";
import { moderatePublication } from "@/lib/moderation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function buildSupabase(user: { id: string } | null) {
  return { auth: { getUser: async () => ({ data: { user } }) } };
}

function buildRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/publications/moderer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/publications/moderer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(moderatePublication).mockResolvedValue({ classification: "ok", raison: "" });
  });

  it("requires authentication", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(null) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/publications/moderer/route");
    const response = await POST(buildRequest({ texte: "hello" }) as never);

    expect(response.status).toBe(401);
    expect(moderatePublication).not.toHaveBeenCalled();
  });

  it("rejects an imageR2Key outside the caller's own upload prefix, before ever fetching it", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/publications/moderer/route");
    const response = await POST(
      buildRequest({ texte: null, imageR2Key: "publications/someone-else/x.jpg" }) as never,
    );

    expect(response.status).toBe(400);
    expect(getObjectBase64).not.toHaveBeenCalled();
    expect(moderatePublication).not.toHaveBeenCalled();
  });

  it("fetches the image from R2 and forwards it to moderatePublication()", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );
    vi.mocked(getObjectBase64).mockResolvedValue({ data: "abc123", contentType: "image/jpeg" });

    const { POST } = await import("@/app/api/publications/moderer/route");
    await POST(
      buildRequest({ texte: "légende", imageR2Key: "publications/u1/photo.jpg" }) as never,
    );

    expect(getObjectBase64).toHaveBeenCalledWith("publications/u1/photo.jpg");
    expect(moderatePublication).toHaveBeenCalledWith({
      texte: "légende",
      imageBase64: { data: "abc123", mediaType: "image/jpeg" },
      framesBase64: [],
    });
  });

  it("degrades to text-only moderation (never blocks the request) when the R2 fetch fails", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );
    vi.mocked(getObjectBase64).mockRejectedValue(new Error("R2 unavailable"));

    const { POST } = await import("@/app/api/publications/moderer/route");
    const response = await POST(
      buildRequest({ texte: "légende", imageR2Key: "publications/u1/photo.jpg" }) as never,
    );

    expect(response.status).toBe(200);
    expect(moderatePublication).toHaveBeenCalledWith({
      texte: "légende",
      imageBase64: null,
      framesBase64: [],
    });
  });

  it("drops an image whose R2 content-type isn't a supported image media type", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );
    vi.mocked(getObjectBase64).mockResolvedValue({ data: "abc123", contentType: "application/octet-stream" });

    const { POST } = await import("@/app/api/publications/moderer/route");
    await POST(buildRequest({ texte: null, imageR2Key: "publications/u1/photo.jpg" }) as never);

    expect(moderatePublication).toHaveBeenCalledWith({
      texte: null,
      imageBase64: null,
      framesBase64: [],
    });
  });

  it("forwards video frame base64 strings as JPEG image blocks, filtering out non-string entries", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/publications/moderer/route");
    await POST(
      buildRequest({
        texte: null,
        videoFramesBase64: ["frame-a", "frame-b", 42, null],
      }) as never,
    );

    expect(moderatePublication).toHaveBeenCalledWith({
      texte: null,
      imageBase64: null,
      framesBase64: [
        { data: "frame-a", mediaType: "image/jpeg" },
        { data: "frame-b", mediaType: "image/jpeg" },
      ],
    });
  });

  it("returns the classification result body from moderatePublication()", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "u1" }) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );
    vi.mocked(moderatePublication).mockResolvedValue({
      classification: "ambigu",
      raison: "ton agressif",
    });

    const { POST } = await import("@/app/api/publications/moderer/route");
    const response = await POST(buildRequest({ texte: "un message" }) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ classification: "ambigu", raison: "ton agressif" });
  });
});
