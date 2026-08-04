import { describe, expect, it } from "vitest";
import { formatVuesCount } from "@/lib/formatCount";

describe("formatVuesCount", () => {
  it("returns the raw number under 1000, no abbreviation", () => {
    expect(formatVuesCount(0, "fr")).toBe("0");
    expect(formatVuesCount(842, "fr")).toBe("842");
    expect(formatVuesCount(999, "fr")).toBe("999");
  });

  it("abbreviates to K with a comma decimal separator in French", () => {
    expect(formatVuesCount(92_600, "fr")).toBe("92,6K");
    expect(formatVuesCount(1_000, "fr")).toBe("1K");
  });

  it("abbreviates to K with a period decimal separator in English", () => {
    expect(formatVuesCount(92_600, "en")).toBe("92.6K");
  });

  it("abbreviates to M once past a million", () => {
    expect(formatVuesCount(19_800_000, "fr")).toBe("19,8M");
    expect(formatVuesCount(19_800_000, "en")).toBe("19.8M");
    expect(formatVuesCount(1_000_000, "fr")).toBe("1M");
  });

  it("truncates toward the real count, never rounds up past it", () => {
    // 999,999 must stay in the K band, never round up to "1.0M".
    expect(formatVuesCount(999_999, "fr")).toBe("999,9K");
  });

  it("drops the decimal entirely when it's a whole number", () => {
    expect(formatVuesCount(5_000, "fr")).toBe("5K");
    expect(formatVuesCount(2_000_000, "fr")).toBe("2M");
  });

  it("treats a negative or non-finite count as 0", () => {
    expect(formatVuesCount(-5, "fr")).toBe("0");
    expect(formatVuesCount(NaN, "fr")).toBe("0");
    expect(formatVuesCount(Infinity, "fr")).toBe("0");
  });
});
