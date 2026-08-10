import { createTranslator } from "use-intl/core";
import { describe, expect, it } from "vitest";
import frMessages from "../../../messages/fr.json";
import {
  calculerRepartitionPaiement,
  describeTransactionStatutFan,
  type StatutFanTranslator,
} from "@/lib/transactions";

// Built from the real messages/fr.json, same discipline as
// classementProgres.test.ts -- a mistake in the message catalog fails
// this test too, rather than a hand-typed duplicate that could drift. See
// that file's comment for why the cast to the library's own loose
// translator type is needed.
const t = createTranslator({
  locale: "fr",
  messages: frMessages,
  namespace: "Dashboard",
}) as unknown as StatutFanTranslator;

describe("calculerRepartitionPaiement (commission 15% HT + TVA répercutée since migration 0024)", () => {
  it("computes commission (15% HT), frais (3%) and tva (16% of commission)", () => {
    const result = calculerRepartitionPaiement(100);

    expect(result.commissionPlateforme).toBeCloseTo(15, 2);
    expect(result.fraisAgregateur).toBeCloseTo(3, 2);
    expect(result.tva).toBeCloseTo(2.4, 2);
  });

  it("deducts both the commission AND its tva from the créateur's net -- only frais_agregateur is absorbed by the platform", () => {
    const result = calculerRepartitionPaiement(100);

    expect(result.montantNetCreateur).toBeCloseTo(82.6, 2);
    expect(result.montantNetCreateur).toBeCloseTo(
      100 - result.commissionPlateforme - result.tva,
      2,
    );
  });

  it("leaves montantMaitreJeu null and montantNetCreateur unchanged when no pourcentageMaitreJeu is given (undefined or null)", () => {
    const withoutArg = calculerRepartitionPaiement(100);
    const withUndefined = calculerRepartitionPaiement(100, undefined);
    const withNull = calculerRepartitionPaiement(100, null);

    for (const result of [withoutArg, withUndefined, withNull]) {
      expect(result.montantMaitreJeu).toBeNull();
      expect(result.montantNetCreateur).toBeCloseTo(82.6, 2);
    }
  });

  it("splits a 3-way Maître du jeu cut off the net-of-commission total, mirroring create_paiement_on_validation() exactly (migration 0047)", () => {
    // $100, 20% -- the same worked example verified against the real SQL
    // trigger in checklist_2_3.sql: net_total = 82.6, montant_maitre_jeu
    // = round(82.6 * 0.20, 2) = 16.52, montant_net_createur = 66.08.
    const result = calculerRepartitionPaiement(100, 20);

    expect(result.commissionPlateforme).toBeCloseTo(15, 2);
    expect(result.fraisAgregateur).toBeCloseTo(3, 2);
    expect(result.tva).toBeCloseTo(2.4, 2);
    expect(result.montantMaitreJeu).toBeCloseTo(16.52, 2);
    expect(result.montantNetCreateur).toBeCloseTo(66.08, 2);
  });

  it("a 0% Maître du jeu split still returns a real (zero) montantMaitreJeu, not null -- distinct from 'no concours link at all'", () => {
    const result = calculerRepartitionPaiement(100, 0);

    expect(result.montantMaitreJeu).toBe(0);
    expect(result.montantNetCreateur).toBeCloseTo(82.6, 2);
  });
});

describe("describeTransactionStatutFan", () => {
  it("includes a concrete deadline for en_attente, not just the raw status", () => {
    const text = describeTransactionStatutFan(
      {
        statut: "en_attente",
        deadlineAcceptation: "2026-07-25T14:30:00.000Z",
        deadlineLivraison: null,
      },
      t,
      "fr",
    );
    expect(text).toContain("En attente de réponse du créateur");
    expect(text).toContain("réponse attendue avant le");
    expect(text).not.toBe("en_attente");
  });

  it("falls back to a plain sentence for en_attente with no deadline set", () => {
    expect(
      describeTransactionStatutFan(
        {
          statut: "en_attente",
          deadlineAcceptation: null,
          deadlineLivraison: null,
        },
        t,
        "fr",
      ),
    ).toBe("En attente de réponse du créateur");
  });

  it("includes a concrete delivery deadline for validee", () => {
    const text = describeTransactionStatutFan(
      {
        statut: "validee",
        deadlineAcceptation: null,
        deadlineLivraison: "2026-07-27T10:00:00.000Z",
      },
      t,
      "fr",
    );
    expect(text).toContain("Accepté, en préparation");
    expect(text).toContain("livraison prévue avant le");
  });

  it("falls back to a plain sentence for validee with no delivery deadline (non video/shoutout types)", () => {
    expect(
      describeTransactionStatutFan(
        {
          statut: "validee",
          deadlineAcceptation: null,
          deadlineLivraison: null,
        },
        t,
        "fr",
      ),
    ).toBe("Accepté, en préparation");
  });

  it.each([
    ["livree", "Livré"],
    ["remboursee", "Remboursé"],
    ["refusee", "Refusé"],
  ])("returns a plain human label for %s with no deadline involved", (statut, expected) => {
    expect(
      describeTransactionStatutFan(
        {
          statut,
          deadlineAcceptation: null,
          deadlineLivraison: null,
        },
        t,
        "fr",
      ),
    ).toBe(expected);
  });

  it("never surfaces a raw/unknown status string silently mistranslated", () => {
    expect(
      describeTransactionStatutFan(
        {
          statut: "un_statut_inconnu",
          deadlineAcceptation: null,
          deadlineLivraison: null,
        },
        t,
        "fr",
      ),
    ).toBe("un_statut_inconnu");
  });

  // Lot 2a: livree + confirmationFan describes the fan-confirmation
  // window for a delivered video/shoutout -- see
  // supabase/migrations/0025_confirmation_fan_video_shoutout.sql.
  it("includes the confirmation deadline for a livree transaction awaiting fan confirmation", () => {
    const text = describeTransactionStatutFan(
      {
        statut: "livree",
        deadlineAcceptation: null,
        deadlineLivraison: null,
        confirmationFan: "en_attente",
        deadlineConfirmation: "2026-07-30T10:00:00.000Z",
      },
      t,
      "fr",
    );
    expect(text).toContain("confirme la réception avant le");
    expect(text).not.toBe("Livré");
  });

  it("describes a disputed delivery distinctly from a plain livree", () => {
    expect(
      describeTransactionStatutFan(
        {
          statut: "livree",
          deadlineAcceptation: null,
          deadlineLivraison: null,
          confirmationFan: "conteste",
          deadlineConfirmation: null,
        },
        t,
        "fr",
      ),
    ).toBe("Signalé -- en cours de révision par notre équipe.");
  });

  it.each(["confirme", "non_applicable", undefined, null])(
    "falls back to the plain 'Livré' label once confirmation_fan is %s (not en_attente/conteste)",
    (confirmationFan) => {
      expect(
        describeTransactionStatutFan(
          {
            statut: "livree",
            deadlineAcceptation: null,
            deadlineLivraison: null,
            confirmationFan,
            deadlineConfirmation: null,
          },
          t,
          "fr",
        ),
      ).toBe("Livré");
    },
  );

  it("never shows the confirmation-deadline text without a real deadline (defensive, shouldn't happen in practice)", () => {
    expect(
      describeTransactionStatutFan(
        {
          statut: "livree",
          deadlineAcceptation: null,
          deadlineLivraison: null,
          confirmationFan: "en_attente",
          deadlineConfirmation: null,
        },
        t,
        "fr",
      ),
    ).toBe("Livré");
  });
});
