import { describe, expect, it } from "vitest";
import {
  computeCountdownParts,
  computeEqualSharePercent,
  computeLeaderIds,
  isConcoursEnded,
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
