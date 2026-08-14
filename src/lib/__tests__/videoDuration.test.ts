import { describe, expect, it } from "vitest";
import {
  computeFrameTimestamps,
  isVideoDurationAllowed,
  MAX_VIDEO_DURATION_SECONDS,
  MODERATION_FRAME_COUNT,
} from "@/lib/videoDuration";

describe("isVideoDurationAllowed", () => {
  it("accepts a duration well under the limit", () => {
    expect(isVideoDurationAllowed(30)).toBe(true);
  });

  it("accepts a duration exactly at the limit (boundary)", () => {
    expect(isVideoDurationAllowed(MAX_VIDEO_DURATION_SECONDS)).toBe(true);
  });

  it("rejects a duration one second over the limit", () => {
    expect(isVideoDurationAllowed(MAX_VIDEO_DURATION_SECONDS + 1)).toBe(false);
  });

  it("rejects zero, negative, NaN, and Infinity", () => {
    expect(isVideoDurationAllowed(0)).toBe(false);
    expect(isVideoDurationAllowed(-5)).toBe(false);
    expect(isVideoDurationAllowed(NaN)).toBe(false);
    expect(isVideoDurationAllowed(Infinity)).toBe(false);
  });
});

describe("computeFrameTimestamps", () => {
  it("uses the default MODERATION_FRAME_COUNT (3) when omitted", () => {
    expect(computeFrameTimestamps(30)).toHaveLength(MODERATION_FRAME_COUNT);
  });

  it("spreads timestamps evenly, nudged off the first/last instant by a small margin", () => {
    const timestamps = computeFrameTimestamps(30, 3);
    expect(timestamps).toHaveLength(3);
    expect(timestamps[0]).toBeCloseTo(0.1, 5);
    expect(timestamps[1]).toBeCloseTo(15, 5);
    expect(timestamps[2]).toBeCloseTo(29.9, 5);
  });

  it("returns a single midpoint timestamp for frameCount 1", () => {
    expect(computeFrameTimestamps(10, 1)).toEqual([5]);
  });

  it("caps the margin at a tenth of a very short clip's duration", () => {
    // duration=1 -> margin would be 0.1 uncapped, which is already <=
    // duration/10 (0.1) here; use an even shorter clip to actually
    // exercise the cap.
    const timestamps = computeFrameTimestamps(0.5, 3);
    expect(timestamps[0]).toBeCloseTo(0.05, 5);
    expect(timestamps[2]).toBeCloseTo(0.45, 5);
  });

  it("returns an empty array for a zero, negative, NaN, or Infinity duration", () => {
    expect(computeFrameTimestamps(0)).toEqual([]);
    expect(computeFrameTimestamps(-5)).toEqual([]);
    expect(computeFrameTimestamps(NaN)).toEqual([]);
    expect(computeFrameTimestamps(Infinity)).toEqual([]);
  });

  it("handles frameCount 0 the same way as 1 (a single midpoint)", () => {
    expect(computeFrameTimestamps(10, 0)).toEqual([5]);
  });
});
