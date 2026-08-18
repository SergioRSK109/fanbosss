import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
  createSupabaseServiceRoleClient: vi.fn(),
}));

import {
  createSupabaseServerClient,
  createSupabaseServiceRoleClient,
} from "@/lib/supabase/server";
import { computeGalerieItems, getGalerieFan, type GalerieCandidate } from "@/lib/galerie";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("computeGalerieItems", () => {
  it("includes a delivered video transaction as mediaType video with no expiry", () => {
    const candidates: GalerieCandidate[] = [
      {
        transactionId: "tx-1",
        createurId: "createur-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        offreType: "video",
        r2Key: null,
        dureeAccesJours: null,
      },
    ];

    expect(computeGalerieItems(candidates)).toEqual([
      {
        transactionId: "tx-1",
        createurId: "createur-1",
        mediaType: "video",
        deliveredAt: "2026-01-01T00:00:00.000Z",
        expiresAt: null,
      },
    ]);
  });

  it("includes a delivered shoutout transaction as mediaType video with no expiry", () => {
    const candidates: GalerieCandidate[] = [
      {
        transactionId: "tx-1",
        createurId: "createur-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        offreType: "shoutout",
        r2Key: null,
        dureeAccesJours: null,
      },
    ];

    expect(computeGalerieItems(candidates)).toEqual([
      {
        transactionId: "tx-1",
        createurId: "createur-1",
        mediaType: "video",
        deliveredAt: "2026-01-01T00:00:00.000Z",
        expiresAt: null,
      },
    ]);
  });

  it("includes a non-expired contenu_debloque with a recognized media file, with a real expiresAt", () => {
    const now = new Date("2026-01-15T00:00:00.000Z");
    const candidates: GalerieCandidate[] = [
      {
        transactionId: "tx-1",
        createurId: "createur-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        offreType: "contenu_debloque",
        r2Key: "offres/offre-1/uuid.jpg",
        dureeAccesJours: null,
      },
    ];

    const result = computeGalerieItems(candidates, now);
    expect(result).toEqual([
      {
        transactionId: "tx-1",
        createurId: "createur-1",
        mediaType: "image",
        deliveredAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2026-01-31T00:00:00.000Z",
      },
    ]);
  });

  it("excludes an expired contenu_debloque (default 30-day window)", () => {
    const now = new Date();
    const createdAt = new Date(now.getTime() - 31 * DAY_MS).toISOString();
    const candidates: GalerieCandidate[] = [
      {
        transactionId: "tx-1",
        createurId: "createur-1",
        createdAt,
        offreType: "contenu_debloque",
        r2Key: "offres/offre-1/uuid.mp3",
        dureeAccesJours: null,
      },
    ];

    expect(computeGalerieItems(candidates, now)).toEqual([]);
  });

  it("excludes an expired contenu_debloque under a créateur-configured custom duration", () => {
    const now = new Date();
    const createdAt = new Date(now.getTime() - 8 * DAY_MS).toISOString();
    const candidates: GalerieCandidate[] = [
      {
        transactionId: "tx-1",
        createurId: "createur-1",
        createdAt,
        offreType: "contenu_debloque",
        r2Key: "offres/offre-1/uuid.mp4",
        dureeAccesJours: 7,
      },
    ];

    expect(computeGalerieItems(candidates, now)).toEqual([]);
  });

  it("excludes a contenu_debloque whose file has no recognized media extension (PDF/ZIP sale)", () => {
    const candidates: GalerieCandidate[] = [
      {
        transactionId: "tx-1",
        createurId: "createur-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        offreType: "contenu_debloque",
        r2Key: "offres/offre-1/uuid", // Phase 1: no extension for a PDF/ZIP
        dureeAccesJours: null,
      },
    ];

    expect(computeGalerieItems(candidates, new Date("2026-01-02T00:00:00.000Z"))).toEqual([]);
  });

  it.each(["don", "whatsapp", "produit", "evenement_live", "campagne"])(
    "excludes a %s transaction regardless of statut, since only livree ever reaches this function",
    (offreType) => {
      const candidates: GalerieCandidate[] = [
        {
          transactionId: "tx-1",
          createurId: "createur-1",
          createdAt: "2026-01-01T00:00:00.000Z",
          offreType,
          r2Key: "offres/offre-1/uuid.jpg",
          dureeAccesJours: null,
        },
      ];

      expect(computeGalerieItems(candidates, new Date("2026-01-02T00:00:00.000Z"))).toEqual([]);
    },
  );

  it("excludes a candidate whose offer type could not be resolved at all", () => {
    const candidates: GalerieCandidate[] = [
      {
        transactionId: "tx-1",
        createurId: "createur-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        offreType: null,
        r2Key: null,
        dureeAccesJours: null,
      },
    ];

    expect(computeGalerieItems(candidates)).toEqual([]);
  });

  it("sorts by deliveredAt descending, most recent first", () => {
    const candidates: GalerieCandidate[] = [
      {
        transactionId: "oldest",
        createurId: "createur-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        offreType: "video",
        r2Key: null,
        dureeAccesJours: null,
      },
      {
        transactionId: "newest",
        createurId: "createur-1",
        createdAt: "2026-01-10T00:00:00.000Z",
        offreType: "video",
        r2Key: null,
        dureeAccesJours: null,
      },
      {
        transactionId: "middle",
        createurId: "createur-1",
        createdAt: "2026-01-05T00:00:00.000Z",
        offreType: "video",
        r2Key: null,
        dureeAccesJours: null,
      },
    ];

    expect(computeGalerieItems(candidates).map((item) => item.transactionId)).toEqual([
      "newest",
      "middle",
      "oldest",
    ]);
  });
});

describe("getGalerieFan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Mirrors this file's own established chain-mock style (see
  // profil.test.ts's own `chain()` helper) but also records every
  // .eq(column, value) call, since this test suite needs to assert the
  // exact filters sent -- not just the final resolved rows.
  function buildAuthenticatedClient(transactions: Record<string, unknown>[]) {
    const eqCalls: { column: string; value: unknown }[] = [];
    const builder: Record<string, unknown> = {
      eq: (column: string, value: unknown) => {
        eqCalls.push({ column, value });
        return builder;
      },
      then: (
        onFulfilled: (value: { data: unknown }) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => Promise.resolve({ data: transactions }).then(onFulfilled, onRejected),
    };
    const client = {
      from: (table: string) => {
        if (table !== "transactions") {
          throw new Error(`unexpected table on the authenticated client: ${table}`);
        }
        return { select: () => builder };
      },
    };
    return { client, eqCalls };
  }

  function buildServiceClient(offres: Record<string, unknown>[]) {
    const inCalls: string[][] = [];
    const client = {
      from: (table: string) => {
        if (table !== "offres") {
          throw new Error(`unexpected table on the service client: ${table}`);
        }
        return {
          select: () => ({
            in: (_column: string, ids: string[]) => {
              inCalls.push(ids);
              return Promise.resolve({ data: offres });
            },
          }),
        };
      },
    };
    return { client, inCalls };
  }

  it("returns an empty gallery with no service-role call when the fan has zero livree transactions", async () => {
    const { client: authClient } = buildAuthenticatedClient([]);
    const { client: serviceClient, inCalls } = buildServiceClient([]);
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      authClient as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(
      serviceClient as unknown as ReturnType<typeof createSupabaseServiceRoleClient>,
    );

    const result = await getGalerieFan("fan-1");

    expect(result).toEqual([]);
    expect(inCalls).toEqual([]);
  });

  it("filters transactions by fan_id and statut=livree, and by createurId when given", async () => {
    const { client: authClient, eqCalls } = buildAuthenticatedClient([]);
    const { client: serviceClient } = buildServiceClient([]);
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      authClient as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(
      serviceClient as unknown as ReturnType<typeof createSupabaseServiceRoleClient>,
    );

    await getGalerieFan("fan-1", { createurId: "createur-9" });

    expect(eqCalls).toEqual(
      expect.arrayContaining([
        { column: "fan_id", value: "fan-1" },
        { column: "statut", value: "livree" },
        { column: "createur_id", value: "createur-9" },
      ]),
    );
  });

  it("does not filter by createur_id at all when no createurId option is given", async () => {
    const { client: authClient, eqCalls } = buildAuthenticatedClient([]);
    const { client: serviceClient } = buildServiceClient([]);
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      authClient as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(
      serviceClient as unknown as ReturnType<typeof createSupabaseServiceRoleClient>,
    );

    await getGalerieFan("fan-1");

    expect(eqCalls.some((c) => c.column === "createur_id")).toBe(false);
  });

  it("resolves offre type/config via the service-role client, restricted to the offre_ids from the fan's own transactions -- never a caller-supplied id", async () => {
    const { client: authClient } = buildAuthenticatedClient([
      {
        id: "tx-1",
        createur_id: "createur-1",
        offre_id: "offre-1",
        created_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "tx-2",
        createur_id: "createur-2",
        offre_id: "offre-2",
        created_at: "2026-01-02T00:00:00.000Z",
      },
      // Same offre_id reused (e.g. two separate purchases of the same
      // offre) -- proves offre_ids are de-duplicated before the
      // service-role read, not one call per transaction.
      {
        id: "tx-3",
        createur_id: "createur-1",
        offre_id: "offre-1",
        created_at: "2026-01-03T00:00:00.000Z",
      },
    ]);
    const { client: serviceClient, inCalls } = buildServiceClient([
      { id: "offre-1", type: "video", config: {} },
      // shoutout, not contenu_debloque, specifically so this test's fixed
      // fixture dates can never accidentally read as "expired" against
      // the real current date -- expiry itself is computeGalerieItems'
      // own concern, already covered in isolation above.
      { id: "offre-2", type: "shoutout", config: {} },
    ]);
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      authClient as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(
      serviceClient as unknown as ReturnType<typeof createSupabaseServiceRoleClient>,
    );

    const result = await getGalerieFan("fan-1");

    expect(inCalls).toHaveLength(1);
    expect(new Set(inCalls[0])).toEqual(new Set(["offre-1", "offre-2"]));
    expect(result.map((item) => item.transactionId).sort()).toEqual(["tx-1", "tx-2", "tx-3"]);
  });

  it("excludes an item whose offre_id could not be resolved by the service-role read at all", async () => {
    const { client: authClient } = buildAuthenticatedClient([
      {
        id: "tx-1",
        createur_id: "createur-1",
        offre_id: "offre-missing",
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const { client: serviceClient } = buildServiceClient([]);
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      authClient as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(
      serviceClient as unknown as ReturnType<typeof createSupabaseServiceRoleClient>,
    );

    const result = await getGalerieFan("fan-1");

    expect(result).toEqual([]);
  });
});
