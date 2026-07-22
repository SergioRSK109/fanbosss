import { describe, expect, it } from "vitest";
import { calculerRepartitionPaiement } from "@/lib/transactions";

describe("calculerRepartitionPaiement (brief 4.5)", () => {
  it("computes commission (20%), frais (3%), tva (16% of commission) and net", () => {
    const result = calculerRepartitionPaiement(100);

    expect(result.commissionPlateforme).toBeCloseTo(20, 2);
    expect(result.fraisAgregateur).toBeCloseTo(3, 2);
    expect(result.tva).toBeCloseTo(3.2, 2);
    expect(result.montantNetCreateur).toBeCloseTo(100 - 20 - 3 - 3.2, 2);
  });
});
