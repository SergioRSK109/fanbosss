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
});
