import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
  createSupabaseServiceRoleClient: vi.fn(),
}));
vi.mock("@/lib/r2", () => ({
  getSignedDownloadUrl: vi.fn(),
}));

import {
  createSupabaseServerClient,
  createSupabaseServiceRoleClient,
} from "@/lib/supabase/server";
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

function buildServiceClient(offre: Record<string, unknown> | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: offre }),
        }),
      }),
    }),
  };
}

function buildRequest(id: string) {
  return {
    request: new Request(`http://localhost/api/transactions/${id}/content-url`),
    params: Promise.resolve({ id }),
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe("GET /api/transactions/[id]/content-url -- time-limited access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an unauthenticated request before touching anything else", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(null, null) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { GET } = await import("@/app/api/transactions/[id]/content-url/route");
    const { request, params } = buildRequest("tx-1");
    const response = await GET(request as never, { params });

    expect(response.status).toBe(401);
    expect(getSignedDownloadUrl).not.toHaveBeenCalled();
  });

  it("rejects when not yet livree, before ever checking the access window", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(
        { id: "fan-1" },
        { id: "tx-1", fan_id: "fan-1", statut: "validee", offre_id: "offre-1", created_at: new Date().toISOString() },
      ) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { GET } = await import("@/app/api/transactions/[id]/content-url/route");
    const { request, params } = buildRequest("tx-1");
    const response = await GET(request as never, { params });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("le contenu n'a pas encore été débloqué");
    expect(getSignedDownloadUrl).not.toHaveBeenCalled();
  });

  it("grants access within the default 30-day window (config omits duree_acces_jours)", async () => {
    const createdAt = new Date(Date.now() - 15 * DAY_MS).toISOString();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(
        { id: "fan-1" },
        { id: "tx-1", fan_id: "fan-1", statut: "livree", offre_id: "offre-1", created_at: createdAt },
      ) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(
      buildServiceClient({
        type: "contenu_debloque",
        config: { r2_key: "contenus/offre-1/a.pdf" },
      }) as unknown as ReturnType<typeof createSupabaseServiceRoleClient>,
    );
    vi.mocked(getSignedDownloadUrl).mockResolvedValue("https://r2.example/signed?exp=123");

    const { GET } = await import("@/app/api/transactions/[id]/content-url/route");
    const { request, params } = buildRequest("tx-1");
    const response = await GET(request as never, { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.url).toBe("https://r2.example/signed?exp=123");
  });

  it("rejects with a distinct 'expired' message once the default 30-day window has passed", async () => {
    const createdAt = new Date(Date.now() - 31 * DAY_MS).toISOString();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(
        { id: "fan-1" },
        { id: "tx-1", fan_id: "fan-1", statut: "livree", offre_id: "offre-1", created_at: createdAt },
      ) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(
      buildServiceClient({
        type: "contenu_debloque",
        config: { r2_key: "contenus/offre-1/a.pdf" },
      }) as unknown as ReturnType<typeof createSupabaseServiceRoleClient>,
    );

    const { GET } = await import("@/app/api/transactions/[id]/content-url/route");
    const { request, params } = buildRequest("tx-1");
    const response = await GET(request as never, { params });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toContain("expiré");
    // Distinct from the "not yet unlocked" message -- the client needs to
    // tell the two failure modes apart.
    expect(body.error).not.toBe("le contenu n'a pas encore été débloqué");
    expect(getSignedDownloadUrl).not.toHaveBeenCalled();
  });

  it("respects a créateur-configured duree_acces_jours shorter than the default (7 days, expired on day 8)", async () => {
    const createdAt = new Date(Date.now() - 8 * DAY_MS).toISOString();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(
        { id: "fan-1" },
        { id: "tx-1", fan_id: "fan-1", statut: "livree", offre_id: "offre-1", created_at: createdAt },
      ) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(
      buildServiceClient({
        type: "contenu_debloque",
        config: { r2_key: "contenus/offre-1/a.pdf", duree_acces_jours: 7 },
      }) as unknown as ReturnType<typeof createSupabaseServiceRoleClient>,
    );

    const { GET } = await import("@/app/api/transactions/[id]/content-url/route");
    const { request, params } = buildRequest("tx-1");
    const response = await GET(request as never, { params });

    expect(response.status).toBe(403);
    expect(getSignedDownloadUrl).not.toHaveBeenCalled();
  });

  it("respects a créateur-configured duree_acces_jours still within its own window (7 days, day 5)", async () => {
    const createdAt = new Date(Date.now() - 5 * DAY_MS).toISOString();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(
        { id: "fan-1" },
        { id: "tx-1", fan_id: "fan-1", statut: "livree", offre_id: "offre-1", created_at: createdAt },
      ) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(
      buildServiceClient({
        type: "contenu_debloque",
        config: { r2_key: "contenus/offre-1/a.pdf", duree_acces_jours: 7 },
      }) as unknown as ReturnType<typeof createSupabaseServiceRoleClient>,
    );
    vi.mocked(getSignedDownloadUrl).mockResolvedValue("https://r2.example/signed?exp=456");

    const { GET } = await import("@/app/api/transactions/[id]/content-url/route");
    const { request, params } = buildRequest("tx-1");
    const response = await GET(request as never, { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.url).toBe("https://r2.example/signed?exp=456");
  });
});
