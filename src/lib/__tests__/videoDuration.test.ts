import { describe, expect, it } from "vitest";
import { isVideoDurationAllowed, MAX_VIDEO_DURATION_SECONDS } from "@/lib/videoDuration";

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
