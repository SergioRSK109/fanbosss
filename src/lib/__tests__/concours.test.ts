import { describe, expect, it } from "vitest";
import {
  computeCountdownParts,
  computeEqualSharePercent,
  computeLeaderIds,
  formatPoints,
  isConcoursEnded,
  isDateInFuture,
} from "@/lib/concours";

const REFERENCE = new Date("2026-08-09T12:00:00.000Z");

describe("computeLeaderIds", () => {
  it("returns nobody when every participant is at zero", () => {
    expect(
      computeLeaderIds([
        { createurId: "a", montantCollecte: 0 },
        { createurId: "b", montantCollecte: 0 },
      ]),
    ).toEqual([]);
  });

  it("returns nobody for an empty participant list", () => {
    expect(computeLeaderIds([])).toEqual([]);
  });

  it("returns the single participant with the highest amount", () => {
    expect(
      computeLeaderIds([
        { createurId: "a", montantCollecte: 40 },
        { createurId: "b", montantCollecte: 100 },
        { createurId: "c", montantCollecte: 10 },
      ]),
    ).toEqual(["b"]);
  });

  it("returns every participant tied for the highest amount", () => {
    expect(
      computeLeaderIds([
        { createurId: "a", montantCollecte: 100 },
        { createurId: "b", montantCollecte: 100 },
        { createurId: "c", montantCollecte: 10 },
      ]),
    ).toEqual(["a", "b"]);
  });
});

describe("isConcoursEnded", () => {
  it("is false before date_fin", () => {
    expect(isConcoursEnded("2026-08-10T12:00:00.000Z", REFERENCE)).toBe(false);
  });

  it("is true exactly at date_fin", () => {
    expect(isConcoursEnded("2026-08-09T12:00:00.000Z", REFERENCE)).toBe(true);
  });

  it("is true after date_fin", () => {
    expect(isConcoursEnded("2026-08-01T12:00:00.000Z", REFERENCE)).toBe(true);
  });
});

// Migration 0048: backs the /concours/[id] page's "Le concours ouvre
// le..." date_debut notice, computed in the data layer (concoursPublic.ts)
// rather than inline in the page's render body -- see that module's own
// comment for why (react-hooks/purity flags a raw `new Date()`/`Date.now()`
// call during a Server Component's render).
describe("isDateInFuture", () => {
  it("is true for a date after now", () => {
    expect(isDateInFuture("2026-08-10T12:00:00.000Z", REFERENCE)).toBe(true);
  });

  it("is false exactly at now", () => {
    expect(isDateInFuture("2026-08-09T12:00:00.000Z", REFERENCE)).toBe(false);
  });

  it("is false for a date before now", () => {
    expect(isDateInFuture("2026-08-01T12:00:00.000Z", REFERENCE)).toBe(false);
  });
});

describe("computeEqualSharePercent", () => {
  it("is 50 for 2 participants", () => {
    expect(computeEqualSharePercent(2)).toBe(50);
  });

  it("splits into thirds for 3 participants", () => {
    expect(computeEqualSharePercent(3)).toBeCloseTo(33.333, 3);
  });

  it("splits evenly for an arbitrary N", () => {
    expect(computeEqualSharePercent(7)).toBeCloseTo(100 / 7, 6);
  });

  it("is 100 for a single participant", () => {
    expect(computeEqualSharePercent(1)).toBe(100);
  });

  it("is 0 for zero or negative participants", () => {
    expect(computeEqualSharePercent(0)).toBe(0);
    expect(computeEqualSharePercent(-1)).toBe(0);
  });
});

describe("computeCountdownParts", () => {
  it("breaks down a multi-day remaining duration", () => {
    // 2 days, 3 hours, 4 minutes, 5 seconds from REFERENCE.
    const dateFin = new Date(
      REFERENCE.getTime() + ((2 * 24 + 3) * 3600 + 4 * 60 + 5) * 1000,
    ).toISOString();
    expect(computeCountdownParts(dateFin, REFERENCE)).toEqual({
      days: 2,
      hours: 3,
      minutes: 4,
      seconds: 5,
    });
  });

  it("clamps at all-zero once dateFin has passed, never negative", () => {
    const dateFin = new Date(REFERENCE.getTime() - 60_000).toISOString();
    expect(computeCountdownParts(dateFin, REFERENCE)).toEqual({
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
    });
  });

  it("is all-zero exactly at dateFin", () => {
    expect(computeCountdownParts(REFERENCE.toISOString(), REFERENCE)).toEqual({
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
    });
  });
});

// /concours/[id]'s "points" display (cosmetic only -- 1 USD = 1 point,
// montantCollecte itself still measures real dollars raised, see that
// page's own comment). Compared against the real Intl.NumberFormat
// output rather than a hand-typed grouped string, same reasoning as
// campagnes.test.ts's own formatMontant tests: fr-FR's grouping
// separator is a narrow no-break space (U+202F), not a plain space, and
// a naive literal would silently never match it.
describe("formatPoints", () => {
  it("groups a 4-digit total with the fr-FR thousands separator by default", () => {
    expect(formatPoints(1205)).toBe(new Intl.NumberFormat("fr-FR").format(1205));
  });

  it("groups with the en-US thousands separator (comma) when that locale is passed", () => {
    expect(formatPoints(1205, "en-US")).toBe("1,205");
  });

  it("leaves a sub-1000 total unchanged (no grouping needed)", () => {
    expect(formatPoints(83)).toBe("83");
  });

  it("never appends a currency symbol -- this is a points count, not a monetary amount", () => {
    expect(formatPoints(1205, "en-US")).not.toMatch(/[$€]/);
  });
});
