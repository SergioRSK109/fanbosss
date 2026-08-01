import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/cinetpay", () => ({
  initiateCinetPayPayment: vi.fn(async () => "https://cinetpay.example/pay/abc"),
}));

import { initiateCinetPayPayment } from "@/lib/cinetpay";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type FakeRow = Record<string, unknown>;

function buildSupabase(
  user: { id: string } | null,
  offre: FakeRow | null,
  reservation: FakeRow | null,
) {
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => {
            if (table === "offres_publiques") {
              return { data: offre, error: offre ? null : { message: "not found" } };
            }
            if (table === "reservations_stock") {
              return { data: reservation, error: reservation ? null : { message: "not found" } };
            }
            return { data: null, error: { message: "unexpected table" } };
          },
        }),
      }),
    }),
  };
}

function buildRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/transactions/initiate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const produitOffre = {
  id: "offre-produit-1",
  type: "produit",
  prix: 25,
  actif: true,
  createur_id: "createur-1",
};

describe("POST /api/transactions/initiate (produit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a produit checkout with no reservationId", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "fan-1" }, produitOffre, null) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/transactions/initiate/route");
    const response = await POST(
      buildRequest({ offreId: "offre-produit-1", quantite: 1 }) as never,
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/reservationId/);
    expect(initiateCinetPayPayment).not.toHaveBeenCalled();
  });

  it("rejects an invalid (non-positive/non-integer) quantite", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "fan-1" }, produitOffre, null) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/transactions/initiate/route");
    const response = await POST(
      buildRequest({ offreId: "offre-produit-1", quantite: 0, reservationId: "res-1" }) as never,
    );

    expect(response.status).toBe(400);
    expect(initiateCinetPayPayment).not.toHaveBeenCalled();
  });

  it("rejects a produit checkout with no adresseLivraison", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "fan-1" }, produitOffre, null) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/transactions/initiate/route");
    const response = await POST(
      buildRequest({ offreId: "offre-produit-1", quantite: 1, reservationId: "res-1" }) as never,
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/adresseLivraison/);
    expect(initiateCinetPayPayment).not.toHaveBeenCalled();
  });

  it("rejects a blank (whitespace-only) adresseLivraison the same way as a missing one", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "fan-1" }, produitOffre, null) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/transactions/initiate/route");
    const response = await POST(
      buildRequest({
        offreId: "offre-produit-1",
        quantite: 1,
        reservationId: "res-1",
        adresseLivraison: "   ",
      }) as never,
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/adresseLivraison/);
    expect(initiateCinetPayPayment).not.toHaveBeenCalled();
  });

  it("rejects a reservationId that doesn't resolve to a row at all (forged/unknown id)", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase({ id: "fan-1" }, produitOffre, null) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { POST } = await import("@/app/api/transactions/initiate/route");
    const response = await POST(
      buildRequest({
        offreId: "offre-produit-1",
        quantite: 1,
        reservationId: "not-mine",
        adresseLivraison: "12 Avenue de la Paix, Kinshasa",
      }) as never,
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/réservation/);
    expect(initiateCinetPayPayment).not.toHaveBeenCalled();
  });

  it("rejects a reservation belonging to a different offre than the one requested", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(
        { id: "fan-1" },
        produitOffre,
        {
          id: "res-1",
          offre_id: "some-other-offre",
          quantite: 1,
          expire_at: new Date(Date.now() + 60_000).toISOString(),
          transaction_id: null,
        },
      ) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/transactions/initiate/route");
    const response = await POST(
      buildRequest({
        offreId: "offre-produit-1",
        quantite: 1,
        reservationId: "res-1",
        adresseLivraison: "12 Avenue de la Paix, Kinshasa",
      }) as never,
    );

    expect(response.status).toBe(400);
    expect(initiateCinetPayPayment).not.toHaveBeenCalled();
  });

  it("rejects an already-confirmed reservation (transaction_id already set)", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(
        { id: "fan-1" },
        produitOffre,
        {
          id: "res-1",
          offre_id: "offre-produit-1",
          quantite: 1,
          expire_at: new Date(Date.now() + 60_000).toISOString(),
          transaction_id: "already-a-real-transaction",
        },
      ) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/transactions/initiate/route");
    const response = await POST(
      buildRequest({
        offreId: "offre-produit-1",
        quantite: 1,
        reservationId: "res-1",
        adresseLivraison: "12 Avenue de la Paix, Kinshasa",
      }) as never,
    );

    expect(response.status).toBe(400);
    expect(initiateCinetPayPayment).not.toHaveBeenCalled();
  });

  it("rejects an expired reservation", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(
        { id: "fan-1" },
        produitOffre,
        {
          id: "res-1",
          offre_id: "offre-produit-1",
          quantite: 1,
          expire_at: new Date(Date.now() - 60_000).toISOString(),
          transaction_id: null,
        },
      ) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/transactions/initiate/route");
    const response = await POST(
      buildRequest({
        offreId: "offre-produit-1",
        quantite: 1,
        reservationId: "res-1",
        adresseLivraison: "12 Avenue de la Paix, Kinshasa",
      }) as never,
    );

    expect(response.status).toBe(400);
    expect(initiateCinetPayPayment).not.toHaveBeenCalled();
  });

  it("rejects a reservation whose quantite doesn't match the requested quantite", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(
        { id: "fan-1" },
        produitOffre,
        {
          id: "res-1",
          offre_id: "offre-produit-1",
          quantite: 2,
          expire_at: new Date(Date.now() + 60_000).toISOString(),
          transaction_id: null,
        },
      ) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/transactions/initiate/route");
    const response = await POST(
      buildRequest({
        offreId: "offre-produit-1",
        quantite: 1,
        reservationId: "res-1",
        adresseLivraison: "12 Avenue de la Paix, Kinshasa",
      }) as never,
    );

    expect(response.status).toBe(400);
    expect(initiateCinetPayPayment).not.toHaveBeenCalled();
  });

  it("computes the amount as prix × quantite and forwards quantite/reservationId in custom", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(
        { id: "fan-1" },
        produitOffre,
        {
          id: "res-1",
          offre_id: "offre-produit-1",
          quantite: 3,
          expire_at: new Date(Date.now() + 60_000).toISOString(),
          transaction_id: null,
        },
      ) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/transactions/initiate/route");
    const response = await POST(
      buildRequest({
        offreId: "offre-produit-1",
        quantite: 3,
        reservationId: "res-1",
        adresseLivraison: "  12 Avenue de la Paix, Kinshasa  ",
      }) as never,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.paymentUrl).toBe("https://cinetpay.example/pay/abc");
    expect(initiateCinetPayPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 75, // 25 × 3
        customerId: "fan-1",
        custom: {
          fanId: "fan-1",
          offreId: "offre-produit-1",
          quantite: 3,
          reservationId: "res-1",
          adresseLivraison: "12 Avenue de la Paix, Kinshasa",
        },
      }),
    );
  });

  it("a non-produit offre (e.g. video) is unaffected -- no quantite/reservationId required, amount is prix alone", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabase(
        { id: "fan-1" },
        { id: "offre-video-1", type: "video", prix: 10, actif: true, createur_id: "createur-1" },
        null,
      ) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { POST } = await import("@/app/api/transactions/initiate/route");
    const response = await POST(buildRequest({ offreId: "offre-video-1" }) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.paymentUrl).toBe("https://cinetpay.example/pay/abc");
    expect(initiateCinetPayPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 10,
        custom: { fanId: "fan-1", offreId: "offre-video-1" },
      }),
    );
  });
});
