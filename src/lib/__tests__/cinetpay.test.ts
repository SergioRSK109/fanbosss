import { describe, expect, it } from "vitest";
import { computeCinetPayToken, refundCinetPayPayment, verifyCinetPaySignature } from "@/lib/cinetpay";

const SECRET = "test-secret-key";
const NOTIFICATION = {
  cpm_site_id: "12345",
  cpm_trans_id: "abc-123",
  cpm_trans_date: "2026-07-22",
  cpm_amount: "10",
  cpm_currency: "USD",
  signature: "sig",
  payment_method: "OM",
  cel_phone_num: "243900000000",
  cpm_phone_prefixe: "243",
  cpm_language: "fr",
  cpm_version: "V4",
  cpm_payment_config: "single",
  cpm_page_action: "PAYMENT",
  cpm_custom: '{"fanId":"f1","offreId":"o1"}',
  cpm_designation: "offre",
  cpm_error_message: "SUCCES",
};

describe("verifyCinetPaySignature (brief checklist: webhook signature)", () => {
  it("rejects when the x-token header is entirely absent", () => {
    expect(verifyCinetPaySignature(NOTIFICATION, null, SECRET)).toBe(false);
    expect(verifyCinetPaySignature(NOTIFICATION, undefined, SECRET)).toBe(false);
  });

  it("rejects an invalid/forged token", () => {
    const forged = "0".repeat(64);
    expect(verifyCinetPaySignature(NOTIFICATION, forged, SECRET)).toBe(false);
  });

  it("rejects when the secret key is not configured, even with a well-formed token", () => {
    const validLookingToken = computeCinetPayToken(NOTIFICATION, "some-other-key");
    expect(
      verifyCinetPaySignature(NOTIFICATION, validLookingToken, undefined),
    ).toBe(false);
  });

  it("never returns true unconditionally (no fail-open path)", () => {
    // Empty/garbage everything: must still be false, not a default `true`.
    expect(verifyCinetPaySignature({}, "", "")).toBe(false);
    expect(verifyCinetPaySignature({}, "not-hex", SECRET)).toBe(false);
  });

  it("accepts a correctly computed token", () => {
    const validToken = computeCinetPayToken(NOTIFICATION, SECRET);
    expect(verifyCinetPaySignature(NOTIFICATION, validToken, SECRET)).toBe(true);
  });

  it("rejects if a single field used in the signature is tampered with", () => {
    const validToken = computeCinetPayToken(NOTIFICATION, SECRET);
    const tampered = { ...NOTIFICATION, cpm_amount: "999999" };
    expect(verifyCinetPaySignature(tampered, validToken, SECRET)).toBe(false);
  });
});

// Deliberately still unimplemented -- no confirmed CinetPay refund API
// contract was found (see CLAUDE.md "Automatic CinetPay refunds"). This
// is a regression guard, not a placeholder to delete: it fails loudly if
// someone "fixes" this into returning a fake success without ever wiring
// up a real, confirmed call -- remboursement_cinetpay_actif depends on
// this staying an explicit failure until that happens.
describe("refundCinetPayPayment (deliberately not implemented)", () => {
  it("always throws -- no real refund call exists yet", async () => {
    await expect(
      refundCinetPayPayment({
        transactionId: "tx-1",
        referenceCinetpayOriginal: "ref-1",
        montant: 10,
      }),
    ).rejects.toThrow(/not implemented/i);
  });
});
