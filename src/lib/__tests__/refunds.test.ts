import { describe, expect, it, vi, beforeEach } from "vitest";
import { computeRefundAmount } from "@/lib/refunds";

vi.mock("@/lib/cinetpay", () => ({
  refundCinetPayPayment: vi.fn(),
}));

import { refundCinetPayPayment } from "@/lib/cinetpay";
import { processAutomaticRefund } from "@/lib/refunds";

type FakeRow = Record<string, unknown>;

// Mirrors the shape of the real Supabase client just enough for
// refunds.ts's two query patterns: select().eq().maybeSingle() and
// update().eq(). Same style as the CinetPay webhook test's mock.
function buildSupabaseMock({
  transaction,
  flagActive,
  pourcentage,
}: {
  transaction: FakeRow | null;
  flagActive: boolean;
  pourcentage?: number;
}) {
  const updates: { table: string; patch: FakeRow }[] = [];

  const client = {
    from(table: string) {
      return {
        select() {
          return {
            eq(_col: string, value: string) {
              return {
                maybeSingle: async () => {
                  if (table === "transactions") {
                    return { data: transaction, error: null };
                  }
                  if (table === "parametres_plateforme") {
                    if (value === "remboursement_cinetpay_actif") {
                      return { data: { valeur: flagActive }, error: null };
                    }
                    if (value === "remboursement_pourcentage") {
                      return { data: { valeur: pourcentage ?? 100 }, error: null };
                    }
                  }
                  return { data: null, error: null };
                },
              };
            },
          };
        },
        update(patch: FakeRow) {
          updates.push({ table, patch });
          return { eq: async () => ({ error: null }) };
        },
      };
    },
  };

  return { client, updates };
}

function baseTransaction(overrides: FakeRow = {}): FakeRow {
  return {
    id: "tx-1",
    montant: 100,
    statut: "remboursee",
    reference_cinetpay: "cp-original-ref",
    reference_remboursement_cinetpay: null,
    remboursement_tentative_a: null,
    ...overrides,
  };
}

describe("computeRefundAmount", () => {
  it("refunds the full amount at 100%", () => {
    expect(computeRefundAmount(1000, 100)).toBe(1000);
  });

  it("applies a lower percentage", () => {
    expect(computeRefundAmount(1000, 80)).toBe(800);
  });

  it("rounds to the cent", () => {
    expect(computeRefundAmount(10, 33)).toBe(3.3);
  });
});

describe("processAutomaticRefund", () => {
  beforeEach(() => {
    vi.mocked(refundCinetPayPayment).mockReset();
  });

  it("does nothing if the transaction isn't found", async () => {
    const { client, updates } = buildSupabaseMock({ transaction: null, flagActive: true });
    await processAutomaticRefund(client as never, "tx-1");
    expect(updates).toHaveLength(0);
    expect(refundCinetPayPayment).not.toHaveBeenCalled();
  });

  it("does nothing if the transaction isn't actually 'remboursee'", async () => {
    const { client, updates } = buildSupabaseMock({
      transaction: baseTransaction({ statut: "validee" }),
      flagActive: true,
    });
    await processAutomaticRefund(client as never, "tx-1");
    expect(updates).toHaveLength(0);
    expect(refundCinetPayPayment).not.toHaveBeenCalled();
  });

  it("is idempotent: never calls again once a refund reference is already confirmed", async () => {
    const { client, updates } = buildSupabaseMock({
      transaction: baseTransaction({ reference_remboursement_cinetpay: "already-refunded" }),
      flagActive: true,
    });
    await processAutomaticRefund(client as never, "tx-1");
    expect(updates).toHaveLength(0);
    expect(refundCinetPayPayment).not.toHaveBeenCalled();
  });

  it("does not attempt the real call while the feature flag is off", async () => {
    const { client, updates } = buildSupabaseMock({
      transaction: baseTransaction(),
      flagActive: false,
    });
    await processAutomaticRefund(client as never, "tx-1");
    expect(updates).toHaveLength(0);
    expect(refundCinetPayPayment).not.toHaveBeenCalled();
  });

  it("does not retry a previous ambiguous (timed-out) attempt", async () => {
    const { client, updates } = buildSupabaseMock({
      transaction: baseTransaction({ remboursement_tentative_a: "2026-01-01T00:00:00Z" }),
      flagActive: true,
    });
    await processAutomaticRefund(client as never, "tx-1");
    expect(updates).toHaveLength(0);
    expect(refundCinetPayPayment).not.toHaveBeenCalled();
  });

  it("records the attempt BEFORE calling CinetPay, then records the confirmed reference on success", async () => {
    vi.mocked(refundCinetPayPayment).mockResolvedValue("cp-refund-ref-123");
    const { client, updates } = buildSupabaseMock({
      transaction: baseTransaction(),
      flagActive: true,
      pourcentage: 100,
    });

    await processAutomaticRefund(client as never, "tx-1");

    expect(refundCinetPayPayment).toHaveBeenCalledWith({
      transactionId: "tx-1",
      referenceCinetpayOriginal: "cp-original-ref",
      montant: 100,
    });
    expect(updates).toHaveLength(2);
    expect(updates[0].table).toBe("transactions");
    expect(updates[0].patch).toHaveProperty("remboursement_tentative_a");
    expect(updates[1].patch).toEqual({
      reference_remboursement_cinetpay: "cp-refund-ref-123",
      montant_rembourse: 100,
      necessite_remboursement_manuel: false,
    });
  });

  it("applies the configured refund percentage, not always 100%", async () => {
    vi.mocked(refundCinetPayPayment).mockResolvedValue("cp-refund-ref-456");
    const { client } = buildSupabaseMock({
      transaction: baseTransaction({ montant: 50 }),
      flagActive: true,
      pourcentage: 80,
    });

    await processAutomaticRefund(client as never, "tx-1");

    expect(refundCinetPayPayment).toHaveBeenCalledWith(
      expect.objectContaining({ montant: 40 }),
    );
  });

  it("leaves necessite_remboursement_manuel alone (never crashes the caller) when the real call fails", async () => {
    vi.mocked(refundCinetPayPayment).mockRejectedValue(new Error("not implemented"));
    const { client, updates } = buildSupabaseMock({
      transaction: baseTransaction(),
      flagActive: true,
    });

    await expect(processAutomaticRefund(client as never, "tx-1")).resolves.toBeUndefined();

    // The attempt is still recorded (so a retry is correctly treated as
    // ambiguous next time), but no confirmed-reference update happens.
    expect(updates).toHaveLength(1);
    expect(updates[0].patch).toHaveProperty("remboursement_tentative_a");
  });
});
