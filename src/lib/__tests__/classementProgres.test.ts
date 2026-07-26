import { createTranslator } from "use-intl/core";
import { describe, expect, it } from "vitest";
import frMessages from "../../../messages/fr.json";
import {
  computeProgressPercent,
  computeReactiviteProgressPercent,
  describeProgressionProgres,
  describeReactiviteProgres,
  describeVolumeProgres,
  formatDureeSecondes,
  type ProgresTranslator,
} from "@/lib/classementProgres";

// Built from the REAL messages/fr.json (not a hand-typed duplicate) so a
// mistake in the message catalog fails this test too, same discipline as
// every other "never drift from the real source" helper in this codebase
// (pseudoLockedUntil, calculerRepartitionPaiement...). Cast to the
// library's own loose translator type: next-intl's `const`-inferred
// Translator type ties `key` to the exact literal shape of whatever
// messages object it was built from, which is far stricter than
// ProgresTranslator needs (and than what next-intl's own
// useTranslations/getTranslations return without a global message-type
// augmentation, which this project doesn't declare).
const t = createTranslator({
  locale: "fr",
  messages: frMessages,
  namespace: "Dashboard.classementProgres",
}) as unknown as ProgresTranslator;

describe("describeVolumeProgres", () => {
  it("shows the exact gap when not yet in the top 10", () => {
    expect(describeVolumeProgres(3, t)).toBe(
      "Plus que 3 transactions livrées pour entrer dans le top 10 volume ce mois-ci.",
    );
  });

  it("uses singular wording for a gap of exactly 1", () => {
    expect(describeVolumeProgres(1, t)).toBe(
      "Plus que 1 transaction livrée pour entrer dans le top 10 volume ce mois-ci.",
    );
  });

  it("celebrates once the gap is closed", () => {
    expect(describeVolumeProgres(0, t)).toBe("Tu es dans le top 10 volume ce mois-ci !");
  });
});

describe("describeReactiviteProgres", () => {
  it("asks for a first response when there is no data yet", () => {
    expect(describeReactiviteProgres(null, null, t)).toBe(
      "Réponds à ta première demande pour voir ta progression réactivité.",
    );
  });

  it("celebrates when already qualifying", () => {
    expect(describeReactiviteProgres(120, 0, t)).toBe(
      "Tu es dans le top 10 réactivité ce mois-ci !",
    );
  });

  it("celebrates when there is no real gap (null manque)", () => {
    expect(describeReactiviteProgres(120, null, t)).toBe(
      "Tu es dans le top 10 réactivité ce mois-ci !",
    );
  });

  it("states the duration to shave off otherwise", () => {
    expect(describeReactiviteProgres(600, 125, t)).toBe(
      "Réponds en moyenne 3 min plus vite pour entrer dans le top 10 réactivité ce mois-ci.",
    );
  });
});

describe("describeProgressionProgres", () => {
  it("flags accounts older than 30 days as not applicable", () => {
    expect(describeProgressionProgres(false, null, t)).toBe(
      "Réservé aux comptes de moins de 30 jours.",
    );
  });

  it("shows the exact gap for an eligible account", () => {
    expect(describeProgressionProgres(true, 2, t)).toBe(
      "Plus que 2 transactions livrées pour entrer dans le top 10 progression ce mois-ci.",
    );
  });

  it("celebrates once the gap is closed", () => {
    expect(describeProgressionProgres(true, 0, t)).toBe(
      "Tu es dans le top 10 progression ce mois-ci !",
    );
  });
});

describe("formatDureeSecondes", () => {
  it("rounds up to the nearest minute, never showing 0", () => {
    expect(formatDureeSecondes(5)).toBe("1 min");
  });

  it("formats under an hour as plain minutes", () => {
    expect(formatDureeSecondes(125)).toBe("3 min");
  });

  it("formats an exact hour without a minutes suffix", () => {
    expect(formatDureeSecondes(3600)).toBe("1h");
  });

  it("formats hours plus minutes", () => {
    expect(formatDureeSecondes(3900)).toBe("1h 5min");
  });
});

describe("computeProgressPercent", () => {
  it("is full when there is no real threshold", () => {
    expect(computeProgressPercent(0, null)).toBe(100);
    expect(computeProgressPercent(0, 0)).toBe(100);
  });

  it("computes the proportion towards the threshold", () => {
    expect(computeProgressPercent(3, 6)).toBe(50);
  });

  it("clamps at 100 once past the threshold", () => {
    expect(computeProgressPercent(9, 6)).toBe(100);
  });
});

describe("computeReactiviteProgressPercent", () => {
  it("is 0 with no data yet", () => {
    expect(computeReactiviteProgressPercent(null, 100)).toBe(0);
  });

  it("is full once already at or under the threshold", () => {
    expect(computeReactiviteProgressPercent(50, 100)).toBe(100);
    expect(computeReactiviteProgressPercent(100, 100)).toBe(100);
  });

  it("is full when there is no real threshold", () => {
    expect(computeReactiviteProgressPercent(500, null)).toBe(100);
  });

  it("computes an inverted proportion above the threshold", () => {
    expect(computeReactiviteProgressPercent(200, 100)).toBe(50);
  });
});
