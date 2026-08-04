import { describe, expect, it } from "vitest";
import {
  computeFurthestFraction,
  shouldCountView,
  VIEW_COUNT_THRESHOLD_FRACTION,
} from "@/lib/videoViewTracking";

describe("computeFurthestFraction", () => {
  it("advances with normal forward playback", () => {
    expect(computeFurthestFraction(0, 5, 20)).toBe(0.25);
    expect(computeFurthestFraction(0.25, 10, 20)).toBe(0.5);
  });

  it("never regresses on a seek backward -- the furthest position is a max, not a reassignment", () => {
    const afterHalf = computeFurthestFraction(0, 10, 20); // 0.5
    const afterSeekingBack = computeFurthestFraction(afterHalf, 2, 20); // would be 0.1
    expect(afterSeekingBack).toBe(0.5);
  });

  it("returns the previous value unchanged for a zero/negative/non-finite duration", () => {
    expect(computeFurthestFraction(0.3, 5, 0)).toBe(0.3);
    expect(computeFurthestFraction(0.3, 5, -1)).toBe(0.3);
    expect(computeFurthestFraction(0.3, 5, NaN)).toBe(0.3);
    expect(computeFurthestFraction(0.3, 5, Infinity)).toBe(0.3);
  });
});

describe("shouldCountView", () => {
  it("is false strictly below the 30% threshold", () => {
    expect(shouldCountView(0)).toBe(false);
    expect(shouldCountView(0.29)).toBe(false);
    expect(shouldCountView(VIEW_COUNT_THRESHOLD_FRACTION - 0.001)).toBe(false);
  });

  it("is true exactly at the 30% threshold", () => {
    expect(shouldCountView(VIEW_COUNT_THRESHOLD_FRACTION)).toBe(true);
    expect(shouldCountView(0.3)).toBe(true);
  });

  it("is true past the threshold", () => {
    expect(shouldCountView(0.5)).toBe(true);
    expect(shouldCountView(1)).toBe(true);
  });
});
