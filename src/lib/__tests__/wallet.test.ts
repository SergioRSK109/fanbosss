import { describe, expect, it } from "vitest";
import { classifyPaiementRecu, RETRAIT_MONTANT_MINIMUM } from "@/lib/wallet";

describe("RETRAIT_MONTANT_MINIMUM", () => {
  it("mirrors the DB check constraint's $25 minimum", () => {
    expect(RETRAIT_MONTANT_MINIMUM).toBe(25);
  });
});

describe("classifyPaiementRecu", () => {
  it("classifies a transaction with no paiements row yet as 'autre'", () => {
    expect(
      classifyPaiementRecu({ statutPaiement: null, confirmationFan: null, litigeResoluAt: null }),
    ).toBe("autre");
  });

  it("classifies statut_paiement='initie' as en_attente_livraison", () => {
    expect(
      classifyPaiementRecu({
        statutPaiement: "initie",
        confirmationFan: "non_applicable",
        litigeResoluAt: null,
      }),
    ).toBe("en_attente_livraison");
  });

  it("classifies statut_paiement='rembourse' as rembourse regardless of confirmation_fan", () => {
    expect(
      classifyPaiementRecu({
        statutPaiement: "rembourse",
        confirmationFan: "conteste",
        litigeResoluAt: null,
      }),
    ).toBe("rembourse");
  });

  it("classifies an unresolved dispute on a successful payment as en_litige", () => {
    expect(
      classifyPaiementRecu({
        statutPaiement: "reussi",
        confirmationFan: "conteste",
        litigeResoluAt: null,
      }),
    ).toBe("en_litige");
  });

  it("classifies a litige resolved faveur_createur as disponible, not en_litige", () => {
    // resoudre_litige()'s faveur_createur branch (migration 0026)
    // deliberately moves confirmation_fan to 'confirme' -- it never
    // leaves it at 'conteste' with litige_resolu_at merely stamped
    // alongside it, so this is the actual reachable shape of a resolved
    // dispute, not a synthetic "conteste + resolved" combination that
    // never really occurs.
    expect(
      classifyPaiementRecu({
        statutPaiement: "reussi",
        confirmationFan: "confirme",
        litigeResoluAt: "2026-07-27T00:00:00.000Z",
      }),
    ).toBe("disponible");
  });

  it("classifies a litige resolved faveur_fan as rembourse, not en_litige", () => {
    // resoudre_litige()'s faveur_fan branch sets statut = 'remboursee',
    // which the pre-existing handle_transaction_remboursement() trigger
    // turns into paiements.statut_paiement = 'rembourse' -- so by the
    // time this classifier ever sees it, statutPaiement is 'rembourse',
    // not 'reussi' + conteste.
    expect(
      classifyPaiementRecu({
        statutPaiement: "rembourse",
        confirmationFan: "conteste",
        litigeResoluAt: "2026-07-27T00:00:00.000Z",
      }),
    ).toBe("rembourse");
  });

  it("classifies confirme/non_applicable successful payments as disponible", () => {
    expect(
      classifyPaiementRecu({
        statutPaiement: "reussi",
        confirmationFan: "confirme",
        litigeResoluAt: null,
      }),
    ).toBe("disponible");
    expect(
      classifyPaiementRecu({
        statutPaiement: "reussi",
        confirmationFan: "non_applicable",
        litigeResoluAt: null,
      }),
    ).toBe("disponible");
  });

  it("classifies a still-pending confirmation ('en_attente') on a successful payment as 'autre', not disponible", () => {
    // solde_wallet_createur()'s net_a_retirer SQL bucket only counts
    // confirmation_fan in ('confirme', 'non_applicable') -- a video/
    // shoutout still inside its 72h confirmation window is paid but not
    // yet withdrawable, so labeling it "disponible" here would disagree
    // with the aggregate above it on the same page.
    expect(
      classifyPaiementRecu({
        statutPaiement: "reussi",
        confirmationFan: "en_attente",
        litigeResoluAt: null,
      }),
    ).toBe("autre");
  });
});
