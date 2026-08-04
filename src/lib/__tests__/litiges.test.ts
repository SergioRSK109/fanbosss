import { describe, expect, it } from "vitest";
import { computeJoursOuvrablesEcoules, computeLitigeUrgence } from "@/lib/litiges";

// Fixed reference dates, all UTC, so the tests are deterministic
// regardless of the test runner's own timezone. 2026-08-04 is a Tuesday;
// 2026-07-31 the preceding Friday; 2026-07-13 a Monday three weekends
// earlier -- verified against a real calendar before being relied on
// here, not assumed.
const TUESDAY = new Date("2026-08-04T12:00:00.000Z");
const MONDAY = new Date("2026-08-03T12:00:00.000Z");

describe("computeJoursOuvrablesEcoules", () => {
  it("returns null when contesteAt is null", () => {
    expect(computeJoursOuvrablesEcoules(null, TUESDAY)).toBeNull();
  });

  it("returns 0 for a dispute filed today, regardless of time of day", () => {
    expect(computeJoursOuvrablesEcoules("2026-08-04T23:59:00.000Z", TUESDAY)).toBe(0);
  });

  it("returns 1 for a dispute filed the previous weekday with no weekend in between", () => {
    expect(computeJoursOuvrablesEcoules("2026-08-03T08:00:00.000Z", TUESDAY)).toBe(1);
  });

  it("excludes a weekend entirely: Friday dispute, Monday now = 1 business day (not 3 calendar days)", () => {
    expect(computeJoursOuvrablesEcoules("2026-07-31T08:00:00.000Z", MONDAY)).toBe(1);
  });

  it("excludes a weekend entirely: Friday dispute, Tuesday now = 2 business days (not 4 calendar days)", () => {
    expect(computeJoursOuvrablesEcoules("2026-07-31T08:00:00.000Z", TUESDAY)).toBe(2);
  });

  it("correctly counts across three full weekends", () => {
    // 2026-07-13 (Monday) to 2026-08-04 (Tuesday): counting from the day
    // after the dispute (Jul 14) through today inclusive is 22 calendar
    // days, 6 of them weekend days (Jul 18-19, 25-26, Aug 1-2) -- 16
    // business days, verified by hand against a real calendar.
    expect(computeJoursOuvrablesEcoules("2026-07-13T08:00:00.000Z", TUESDAY)).toBe(16);
  });

  it("defaults `now` to the current time when omitted", () => {
    const justNow = new Date().toISOString();
    expect(computeJoursOuvrablesEcoules(justNow)).toBe(0);
  });
});

describe("computeLitigeUrgence", () => {
  it("returns null when joursOuvrablesEcoules is null", () => {
    expect(computeLitigeUrgence(null)).toBeNull();
  });

  it("returns normal under 10 business days", () => {
    expect(computeLitigeUrgence(0)).toBe("normal");
    expect(computeLitigeUrgence(9)).toBe("normal");
  });

  it("returns attention at exactly 10 business days (the lower boundary)", () => {
    expect(computeLitigeUrgence(10)).toBe("attention");
  });

  it("returns attention at exactly 15 business days (the upper boundary, still held)", () => {
    expect(computeLitigeUrgence(15)).toBe("attention");
  });

  it("returns retard the instant it passes 15 business days", () => {
    expect(computeLitigeUrgence(16)).toBe("retard");
  });

  it("returns retard for a large overdue count", () => {
    expect(computeLitigeUrgence(40)).toBe("retard");
  });
});
