import { describe, expect, it } from "vitest";
import {
  computeCampagneProgressPercent,
  computeCampagneStatus,
  computeJoursRestants,
} from "@/lib/campagnes";

const REFERENCE = new Date("2026-07-25T12:00:00.000Z");

describe("computeCampagneStatus", () => {
  it("is active while below goal, no date_fin, and actif", () => {
    expect(
      computeCampagneStatus({
        actif: true,
        montantCollecte: 40,
        objectif: 100,
        dateFin: null,
        now: REFERENCE,
      }),
    ).toBe("active");
  });

  it("is objectif_atteint once collecte reaches the goal exactly", () => {
    expect(
      computeCampagneStatus({
        actif: false,
        montantCollecte: 100,
        objectif: 100,
        dateFin: null,
        now: REFERENCE,
      }),
    ).toBe("objectif_atteint");
  });

  it("is objectif_atteint once collecte exceeds the goal", () => {
    expect(
      computeCampagneStatus({
        actif: false,
        montantCollecte: 150,
        objectif: 100,
        dateFin: null,
        now: REFERENCE,
      }),
    ).toBe("objectif_atteint");
  });

  it("objectif_atteint takes priority over date_fin having passed", () => {
    expect(
      computeCampagneStatus({
        actif: false,
        montantCollecte: 100,
        objectif: 100,
        dateFin: "2026-01-01",
        now: REFERENCE,
      }),
    ).toBe("objectif_atteint");
  });

  it("is terminee once date_fin is strictly in the past", () => {
    expect(
      computeCampagneStatus({
        actif: false,
        montantCollecte: 40,
        objectif: 100,
        dateFin: "2026-07-24",
        now: REFERENCE,
      }),
    ).toBe("terminee");
  });

  it("stays active through the entirety of date_fin's own day (boundary)", () => {
    expect(
      computeCampagneStatus({
        actif: true,
        montantCollecte: 40,
        objectif: 100,
        dateFin: "2026-07-25",
        now: REFERENCE,
      }),
    ).toBe("active");
  });

  it("is terminee when actif is false for any other reason (e.g. manually paused)", () => {
    expect(
      computeCampagneStatus({
        actif: false,
        montantCollecte: 40,
        objectif: 100,
        dateFin: null,
        now: REFERENCE,
      }),
    ).toBe("terminee");
  });
});

describe("computeCampagneProgressPercent", () => {
  it("computes a plain percentage below the goal", () => {
    expect(computeCampagneProgressPercent(25, 100)).toBe(25);
  });

  it("clamps at 100 once collecte exceeds objectif", () => {
    expect(computeCampagneProgressPercent(150, 100)).toBe(100);
  });

  it("never goes negative, and returns 0 for a zero/invalid objectif", () => {
    expect(computeCampagneProgressPercent(10, 0)).toBe(0);
    expect(computeCampagneProgressPercent(-5, 100)).toBe(0);
  });
});

describe("computeJoursRestants", () => {
  it("returns null when there is no date_fin", () => {
    expect(computeJoursRestants(null, REFERENCE)).toBeNull();
  });

  it("returns 0 on date_fin's own day (last day, inclusive)", () => {
    expect(computeJoursRestants("2026-07-25", REFERENCE)).toBe(0);
  });

  it("returns a positive count of days for a future date_fin", () => {
    expect(computeJoursRestants("2026-07-28", REFERENCE)).toBe(3);
  });
});
