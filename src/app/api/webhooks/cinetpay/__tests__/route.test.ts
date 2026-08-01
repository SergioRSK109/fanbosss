import { describe, expect, it, vi, beforeEach } from "vitest";
import { computeCinetPayToken } from "@/lib/cinetpay";

const SECRET = "webhook-secret";
process.env.CINETPAY_SECRET_KEY = SECRET;

type FakeRow = Record<string, unknown>;

interface ProduitMockOptions {
  disponibiliteDefinitif?: number;
  reservationUpdateError?: { message: string } | null;
  disponibiliteError?: { message: string } | null;
}

function buildSupabaseMock(
  offre: FakeRow,
  existingTransaction: FakeRow | null,
  rpcError: { message: string } | null = null,
  produitOptions: ProduitMockOptions = {},
) {
  const updates: { table: string; patch: FakeRow; filters: [string, unknown[]][] }[] = [];
  const inserts: { table: string; row: FakeRow }[] = [];
  const rpcCalls: { fn: string; args: FakeRow }[] = [];

  // A chainable stand-in for supabase-js's real query builder: .eq()/.is()
  // can be called any number of times in any order (the webhook's
  // reservation-confirm update chains three .eq() then one .is()) before
  // the whole thing is awaited -- `then` is what makes that final `await`
  // resolve, exactly like the real builder being a thenable.
  function chainableUpdate(entry: (typeof updates)[number], result: { error: unknown }) {
    const obj = {
      eq(...args: unknown[]) {
        entry.filters.push(["eq", args]);
        return obj;
      },
      is(...args: unknown[]) {
        entry.filters.push(["is", args]);
        return obj;
      },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return obj;
  }

  const client = {
    from(table: string) {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({
                  data: table === "transactions" ? existingTransaction : null,
                  error: null,
                }),
                single: async () => {
                  if (table === "offres") {
                    return { data: offre, error: null };
                  }
                  if (table === "offres_disponibilite_produit") {
                    return {
                      data: { disponible_definitif: produitOptions.disponibiliteDefinitif ?? 1 },
                      error: produitOptions.disponibiliteError ?? null,
                    };
                  }
                  return { data: null, error: { message: "not found" } };
                },
              };
            },
          };
        },
        insert(row: FakeRow) {
          inserts.push({ table, row });
          return { error: null };
        },
        update(patch: FakeRow) {
          const entry = { table, patch, filters: [] as [string, unknown[]][] };
          updates.push(entry);
          const error =
            table === "reservations_stock" ? (produitOptions.reservationUpdateError ?? null) : null;
          return chainableUpdate(entry, { error });
        },
      };
    },
    rpc(fn: string, args: FakeRow) {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ error: rpcError, data: null });
    },
  };

  return { client, updates, inserts, rpcCalls };
}

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

function buildNotification(overrides: Record<string, string> = {}) {
  return {
    cpm_site_id: "1",
    cpm_trans_id: "tx-don-1",
    cpm_trans_date: "2026-07-22",
    cpm_amount: "3",
    cpm_currency: "USD",
    signature: "sig",
    payment_method: "OM",
    cel_phone_num: "243900000000",
    cpm_phone_prefixe: "243",
    cpm_language: "fr",
    cpm_version: "V4",
    cpm_payment_config: "single",
    cpm_page_action: "PAYMENT",
    cpm_custom: JSON.stringify({ fanId: "fan-1", offreId: "offre-don-1" }),
    cpm_designation: "don",
    cpm_error_message: "SUCCES",
    cpm_trans_status: "ACCEPTED",
    ...overrides,
  };
}

function buildRequest(notification: Record<string, string>, token: string | null) {
  const form = new URLSearchParams(notification);
  const headers = new Headers({
    "content-type": "application/x-www-form-urlencoded",
  });
  if (token !== null) headers.set("x-token", token);

  return new Request("http://localhost/api/webhooks/cinetpay", {
    method: "POST",
    headers,
    body: form.toString(),
  }) as unknown as import("next/server").NextRequest;
}

describe("POST /api/webhooks/cinetpay (brief checklist items 1 & 4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a request with an invalid signature (403), never processes it", async () => {
    const { POST } = await import("@/app/api/webhooks/cinetpay/route");
    const notification = buildNotification();
    const request = buildRequest(notification, "deadbeef".repeat(8));

    const response = await POST(request);
    expect(response.status).toBe(403);
    expect(createSupabaseServiceRoleClient).not.toHaveBeenCalled();
  });

  it("rejects a request with no signature header at all (403)", async () => {
    const { POST } = await import("@/app/api/webhooks/cinetpay/route");
    const notification = buildNotification();
    const request = buildRequest(notification, null);

    const response = await POST(request);
    expect(response.status).toBe(403);
  });

  it("a validly-signed don notification moves straight to livree, never sits at en_attente", async () => {
    const { client, updates, inserts } = buildSupabaseMock(
      { id: "offre-don-1", type: "don", createur_id: "createur-1", prix: 3 },
      null,
    );
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(
      client as unknown as ReturnType<typeof createSupabaseServiceRoleClient>,
    );

    const { POST } = await import("@/app/api/webhooks/cinetpay/route");
    const notification = buildNotification();
    const token = computeCinetPayToken(notification, SECRET);
    const request = buildRequest(notification, token);

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");

    expect(inserts).toHaveLength(1);
    expect(inserts[0].row).not.toHaveProperty("statut");

    const statutsApplied = updates.map((update) => update.patch.statut);
    expect(statutsApplied).toEqual(["validee", "livree"]);
  });

  it.each(["contenu_debloque", "evenement_live", "campagne"] as const)(
    "a validly-signed %s notification also moves straight to livree (brief v3 point 2 / fundraising campaigns)",
    async (type) => {
      const { client, updates, inserts } = buildSupabaseMock(
        { id: "offre-1", type, createur_id: "createur-1", prix: 3 },
        null,
      );
      vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(
        client as unknown as ReturnType<typeof createSupabaseServiceRoleClient>,
      );

      const { POST } = await import("@/app/api/webhooks/cinetpay/route");
      const notification = buildNotification();
      const token = computeCinetPayToken(notification, SECRET);
      const request = buildRequest(notification, token);

      const response = await POST(request);
      expect(response.status).toBe(200);

      expect(inserts).toHaveLength(1);
      const statutsApplied = updates.map((update) => update.patch.statut);
      expect(statutsApplied).toEqual(["validee", "livree"]);
    },
  );

  it("a validly-signed video notification is only recorded, never auto-validated", async () => {
    const { client, updates, inserts } = buildSupabaseMock(
      { id: "offre-video-1", type: "video", createur_id: "createur-1", prix: 3 },
      null,
    );
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(
      client as unknown as ReturnType<typeof createSupabaseServiceRoleClient>,
    );

    const { POST } = await import("@/app/api/webhooks/cinetpay/route");
    const notification = buildNotification({ cpm_amount: "3" });
    const token = computeCinetPayToken(notification, SECRET);
    const request = buildRequest(notification, token);

    const response = await POST(request);
    expect(response.status).toBe(200);

    expect(inserts).toHaveLength(1);
    expect(updates).toHaveLength(0);
  });

  it("a campagne contribution is never rejected by the price-match check, even though its prix is null", async () => {
    const { client, updates, inserts } = buildSupabaseMock(
      { id: "offre-campagne-1", type: "campagne", createur_id: "createur-1", prix: null },
      null,
    );
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(
      client as unknown as ReturnType<typeof createSupabaseServiceRoleClient>,
    );

    const { POST } = await import("@/app/api/webhooks/cinetpay/route");
    // A free-amount contribution, deliberately far from any "prix" --
    // there is none to match against, unlike a fixed-price offer type.
    const notification = buildNotification({ cpm_amount: "47" });
    const token = computeCinetPayToken(notification, SECRET);
    const request = buildRequest(notification, token);

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(inserts).toHaveLength(1);
    expect(inserts[0].row.montant).toBe(47);
    const statutsApplied = updates.map((update) => update.patch.statut);
    expect(statutsApplied).toEqual(["validee", "livree"]);
  });

  it("throws rather than silently defaulting when the offer join fails to produce a type", async () => {
    const { client } = buildSupabaseMock(
      { id: "offre-don-1", type: null, createur_id: "createur-1", prix: 3 },
      null,
    );
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(
      client as unknown as ReturnType<typeof createSupabaseServiceRoleClient>,
    );

    const { POST } = await import("@/app/api/webhooks/cinetpay/route");
    const notification = buildNotification();
    const token = computeCinetPayToken(notification, SECRET);
    const request = buildRequest(notification, token);

    await expect(POST(request)).rejects.toThrow(/offer type could not be determined/);
  });

  it("Lot 6a: a video (has-acceptation) transaction creates a demande_recue notification for the créateur", async () => {
    const { client, rpcCalls } = buildSupabaseMock(
      { id: "offre-video-1", type: "video", createur_id: "createur-1", prix: 3 },
      null,
    );
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(
      client as unknown as ReturnType<typeof createSupabaseServiceRoleClient>,
    );

    const { POST } = await import("@/app/api/webhooks/cinetpay/route");
    const notification = buildNotification({ cpm_amount: "3" });
    const token = computeCinetPayToken(notification, SECRET);
    const request = buildRequest(notification, token);

    const response = await POST(request);
    expect(response.status).toBe(200);

    expect(rpcCalls).toEqual([
      {
        fn: "creer_notification",
        args: {
          p_destinataire_id: "createur-1",
          p_type: "demande_recue",
          p_transaction_id: "tx-don-1",
          p_acteur_id: "fan-1",
        },
      },
    ]);
  });

  it("Lot 6a: a don creates a don_recu notification for the créateur", async () => {
    const { client, rpcCalls } = buildSupabaseMock(
      { id: "offre-don-1", type: "don", createur_id: "createur-1", prix: 3 },
      null,
    );
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(
      client as unknown as ReturnType<typeof createSupabaseServiceRoleClient>,
    );

    const { POST } = await import("@/app/api/webhooks/cinetpay/route");
    const notification = buildNotification();
    const token = computeCinetPayToken(notification, SECRET);
    const request = buildRequest(notification, token);

    const response = await POST(request);
    expect(response.status).toBe(200);

    expect(rpcCalls).toEqual([
      {
        fn: "creer_notification",
        args: {
          p_destinataire_id: "createur-1",
          p_type: "don_recu",
          p_transaction_id: "tx-don-1",
          p_acteur_id: "fan-1",
        },
      },
    ]);
  });

  it.each(["contenu_debloque", "evenement_live"] as const)(
    "Lot 6a: a %s purchase creates no notification at all (deliberate scope limit, neither demande_recue nor don_recu fits)",
    async (type) => {
      const { client, rpcCalls } = buildSupabaseMock(
        { id: "offre-1", type, createur_id: "createur-1", prix: 3 },
        null,
      );
      vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(
        client as unknown as ReturnType<typeof createSupabaseServiceRoleClient>,
      );

      const { POST } = await import("@/app/api/webhooks/cinetpay/route");
      const notification = buildNotification();
      const token = computeCinetPayToken(notification, SECRET);
      const request = buildRequest(notification, token);

      const response = await POST(request);
      expect(response.status).toBe(200);
      expect(rpcCalls).toHaveLength(0);
    },
  );

  it("Lot 6a: a notification RPC failure never fails the webhook itself -- the transaction is already safely recorded", async () => {
    const { client } = buildSupabaseMock(
      { id: "offre-don-1", type: "don", createur_id: "createur-1", prix: 3 },
      null,
      { message: "notifications table is temporarily unavailable" },
    );
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(
      client as unknown as ReturnType<typeof createSupabaseServiceRoleClient>,
    );
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { POST } = await import("@/app/api/webhooks/cinetpay/route");
    const notification = buildNotification();
    const token = computeCinetPayToken(notification, SECRET);
    const request = buildRequest(notification, token);

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});

describe("POST /api/webhooks/cinetpay (produit physique, Phase 1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const produitOffre = {
    id: "offre-produit-1",
    type: "produit",
    createur_id: "createur-1",
    prix: 15,
  };

  it("rejects a produit notification missing quantite/reservationId in cpm_custom", async () => {
    const { client, inserts } = buildSupabaseMock(produitOffre, null);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(
      client as unknown as ReturnType<typeof createSupabaseServiceRoleClient>,
    );

    const { POST } = await import("@/app/api/webhooks/cinetpay/route");
    const notification = buildNotification({
      cpm_amount: "15",
      cpm_custom: JSON.stringify({ fanId: "fan-1", offreId: "offre-produit-1" }),
    });
    const token = computeCinetPayToken(notification, SECRET);
    const request = buildRequest(notification, token);

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/quantite|reservationId/);
    expect(inserts).toHaveLength(0);
  });

  it("rejects a montant that doesn't match prix × quantite", async () => {
    const { client, inserts } = buildSupabaseMock(produitOffre, null);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(
      client as unknown as ReturnType<typeof createSupabaseServiceRoleClient>,
    );

    const { POST } = await import("@/app/api/webhooks/cinetpay/route");
    // prix=15, quantite=2 -> expected 30, but only 15 was actually paid.
    const notification = buildNotification({
      cpm_amount: "15",
      cpm_custom: JSON.stringify({
        fanId: "fan-1",
        offreId: "offre-produit-1",
        quantite: 2,
        reservationId: "res-1",
      }),
    });
    const token = computeCinetPayToken(notification, SECRET);
    const request = buildRequest(notification, token);

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/montant/);
    expect(inserts).toHaveLength(0);
  });

  it("accepts montant = prix × quantite, records the transaction with the real quantite, confirms the reservation, and leaves statut at en_attente", async () => {
    const { client, inserts, updates, rpcCalls } = buildSupabaseMock(produitOffre, null, null, {
      disponibiliteDefinitif: 4, // still stock left after this sale -- offre must stay actif
    });
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(
      client as unknown as ReturnType<typeof createSupabaseServiceRoleClient>,
    );

    const { POST } = await import("@/app/api/webhooks/cinetpay/route");
    const notification = buildNotification({
      cpm_amount: "45",
      cpm_custom: JSON.stringify({
        fanId: "fan-1",
        offreId: "offre-produit-1",
        quantite: 3,
        reservationId: "res-1",
      }),
    });
    const token = computeCinetPayToken(notification, SECRET);
    const request = buildRequest(notification, token);

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");

    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe("transactions");
    expect(inserts[0].row.quantite).toBe(3);
    expect(inserts[0].row.montant).toBe(45);
    // produit has no forced validee/livree cascade -- delivery is a
    // physical shipment, not something payment success alone completes.
    expect(inserts[0].row).not.toHaveProperty("statut");

    const reservationUpdate = updates.find((u) => u.table === "reservations_stock");
    expect(reservationUpdate).toBeDefined();
    expect(reservationUpdate?.patch).toEqual({ transaction_id: "tx-don-1" });
    expect(reservationUpdate?.filters).toEqual([
      ["eq", ["id", "res-1"]],
      ["eq", ["offre_id", "offre-produit-1"]],
      ["eq", ["fan_id", "fan-1"]],
      ["is", ["transaction_id", null]],
    ]);

    // Still stock left (disponibiliteDefinitif=4) -- offres.actif is never
    // touched.
    expect(updates.some((u) => u.table === "offres")).toBe(false);

    // Not in TYPES_A_VALIDATION_IMMEDIATE -- same "has something to act
    // on" notification as video/whatsapp/shoutout.
    expect(rpcCalls).toEqual([
      {
        fn: "creer_notification",
        args: {
          p_destinataire_id: "createur-1",
          p_type: "demande_recue",
          p_transaction_id: "tx-don-1",
          p_acteur_id: "fan-1",
        },
      },
    ]);

    expect(updates.filter((u) => u.table === "transactions")).toHaveLength(0);
  });

  it("closes the offre (actif=false) the instant disponible_definitif reaches 0 after the confirmed sale", async () => {
    const { client, updates } = buildSupabaseMock(produitOffre, null, null, {
      disponibiliteDefinitif: 0, // this sale used the last unit
    });
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(
      client as unknown as ReturnType<typeof createSupabaseServiceRoleClient>,
    );

    const { POST } = await import("@/app/api/webhooks/cinetpay/route");
    const notification = buildNotification({
      cpm_amount: "15",
      cpm_custom: JSON.stringify({
        fanId: "fan-1",
        offreId: "offre-produit-1",
        quantite: 1,
        reservationId: "res-1",
      }),
    });
    const token = computeCinetPayToken(notification, SECRET);
    const request = buildRequest(notification, token);

    const response = await POST(request);
    expect(response.status).toBe(200);

    const offreUpdate = updates.find((u) => u.table === "offres");
    expect(offreUpdate?.patch).toEqual({ actif: false });
  });

  it("throws (never silently swallows) when confirming the reservation fails -- this is essential bookkeeping, not an optional side effect", async () => {
    const { client } = buildSupabaseMock(produitOffre, null, null, {
      reservationUpdateError: { message: "reservation row vanished" },
    });
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(
      client as unknown as ReturnType<typeof createSupabaseServiceRoleClient>,
    );

    const { POST } = await import("@/app/api/webhooks/cinetpay/route");
    const notification = buildNotification({
      cpm_amount: "15",
      cpm_custom: JSON.stringify({
        fanId: "fan-1",
        offreId: "offre-produit-1",
        quantite: 1,
        reservationId: "res-1",
      }),
    });
    const token = computeCinetPayToken(notification, SECRET);
    const request = buildRequest(notification, token);

    await expect(POST(request)).rejects.toThrow(/failed to confirm stock reservation/);
  });
});
