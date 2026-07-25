import { describe, expect, it } from "vitest";
import { calculerRepartitionPaiement } from "@/lib/transactions";

describe("calculerRepartitionPaiement (brief 4.5, commission 17% since migration 0018)", () => {
  it("computes commission (17%), frais (3%) and tva (16% of commission) for bookkeeping", () => {
    const result = calculerRepartitionPaiement(100);

    expect(result.commissionPlateforme).toBeCloseTo(17, 2);
    expect(result.fraisAgregateur).toBeCloseTo(3, 2);
    expect(result.tva).toBeCloseTo(2.72, 2);
  });

  it("deducts only the commission from the créateur's net -- frais/tva are absorbed by the platform, not passed through", () => {
    const result = calculerRepartitionPaiement(100);

    expect(result.montantNetCreateur).toBeCloseTo(83, 2);
    expect(result.montantNetCreateur).toBeCloseTo(
      100 - result.commissionPlateforme,
      2,
    );
  });
});
