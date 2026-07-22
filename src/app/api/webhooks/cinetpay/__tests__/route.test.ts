import { describe, expect, it, vi, beforeEach } from "vitest";
import { computeCinetPayToken } from "@/lib/cinetpay";

const SECRET = "webhook-secret";
process.env.CINETPAY_SECRET_KEY = SECRET;

type FakeRow = Record<string, unknown>;

function buildSupabaseMock(offre: FakeRow, existingTransaction: FakeRow | null) {
  const updates: { table: string; patch: FakeRow }[] = [];
  const inserts: { table: string; row: FakeRow }[] = [];

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
                single: async () => ({
                  data: table === "offres" ? offre : null,
                  error: table === "offres" ? null : { message: "not found" },
                }),
              };
            },
          };
        },
        insert(row: FakeRow) {
          inserts.push({ table, row });
          return { error: null };
        },
        update(patch: FakeRow) {
          updates.push({ table, patch });
          return {
            eq: async () => ({ error: null }),
          };
        },
      };
    },
  };

  return { client, updates, inserts };
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
});
