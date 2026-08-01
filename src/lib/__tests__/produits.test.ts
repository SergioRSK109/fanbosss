import { describe, expect, it } from "vitest";
import {
  buildQuantiteOptions,
  computeDisponibiliteEtat,
  computeRemainingSeconds,
  formatCountdown,
  RESERVATION_HOLD_SECONDS,
} from "@/lib/produits";

describe("computeDisponibiliteEtat", () => {
  it("returns en_stock whenever disponibleMaintenant is positive, regardless of disponibleDefinitif", () => {
    expect(computeDisponibiliteEtat(3, 3)).toBe("en_stock");
    expect(computeDisponibiliteEtat(1, 5)).toBe("en_stock");
  });

  it("returns reserve when disponibleMaintenant is 0 but disponibleDefinitif is still positive", () => {
    expect(computeDisponibiliteEtat(0, 2)).toBe("reserve");
  });

  it("returns epuise when both are 0", () => {
    expect(computeDisponibiliteEtat(0, 0)).toBe("epuise");
  });
});

describe("buildQuantiteOptions", () => {
  it("returns [1..n] for a positive disponibleMaintenant", () => {
    expect(buildQuantiteOptions(4)).toEqual([1, 2, 3, 4]);
  });

  it("returns [1] for exactly 1 in stock", () => {
    expect(buildQuantiteOptions(1)).toEqual([1]);
  });

  it("returns [] for 0", () => {
    expect(buildQuantiteOptions(0)).toEqual([]);
  });

  it("returns [] for a negative value", () => {
    expect(buildQuantiteOptions(-3)).toEqual([]);
  });

  it("returns [] for a non-finite value (NaN/Infinity)", () => {
    expect(buildQuantiteOptions(NaN)).toEqual([]);
    expect(buildQuantiteOptions(Infinity)).toEqual([]);
  });

  it("floors a fractional value rather than throwing", () => {
    expect(buildQuantiteOptions(2.9)).toEqual([1, 2]);
  });
});

describe("computeRemainingSeconds", () => {
  const now = Date.parse("2026-08-01T12:00:00.000Z");

  it("computes whole seconds remaining from an ISO string in the future", () => {
    const expireAt = new Date(now + 90_000).toISOString();
    expect(computeRemainingSeconds(expireAt, now)).toBe(90);
  });

  it("accepts an already-parsed epoch ms number", () => {
    expect(computeRemainingSeconds(now + 45_000, now)).toBe(45);
  });

  it("never goes negative once expireAt has passed", () => {
    const expireAt = new Date(now - 60_000).toISOString();
    expect(computeRemainingSeconds(expireAt, now)).toBe(0);
  });

  it("rounds to the nearest second", () => {
    expect(computeRemainingSeconds(now + 30_400, now)).toBe(30);
    expect(computeRemainingSeconds(now + 30_600, now)).toBe(31);
  });

  it("defaults to Date.now() when no reference time is passed", () => {
    const soon = new Date(Date.now() + 5000).toISOString();
    const remaining = computeRemainingSeconds(soon);
    expect(remaining).toBeGreaterThanOrEqual(4);
    expect(remaining).toBeLessThanOrEqual(5);
  });
});

describe("formatCountdown", () => {
  it("zero-pads both minutes and seconds under 10", () => {
    expect(formatCountdown(9)).toBe("00:09");
  });

  it("formats a full 10-minute hold correctly", () => {
    expect(formatCountdown(RESERVATION_HOLD_SECONDS)).toBe("10:00");
  });

  it("crosses the minute boundary correctly", () => {
    expect(formatCountdown(61)).toBe("01:01");
  });

  it("formats exactly 0 as 00:00", () => {
    expect(formatCountdown(0)).toBe("00:00");
  });

  it("does not zero-pad minutes beyond 2 digits when over 99 minutes (no truncation)", () => {
    expect(formatCountdown(6000)).toBe("100:00");
  });
});
