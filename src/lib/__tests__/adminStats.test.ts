import { describe, expect, it } from "vitest";
import {
  ADMIN_STATS_WINDOW_DAYS,
  buildDailyCountSeries,
  buildDailyDateBuckets,
  buildDailySumSeries,
  computeOffreTypeBreakdown,
  computeStatsWindowStartIso,
  isActiveWithinWindow,
} from "@/lib/adminStats";

// Fixed reference instant, UTC, so every test is deterministic regardless
// of the runner's own timezone -- same discipline as litiges.test.ts.
const NOW = new Date("2026-08-13T15:00:00.000Z");

describe("isActiveWithinWindow", () => {
  it("returns false for a null last_sign_in_at (never authenticated)", () => {
    expect(isActiveWithinWindow(null, 30, NOW)).toBe(false);
  });

  it("returns true for a sign-in exactly at the 30-day boundary", () => {
    const exactlyThirtyDaysAgo = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(isActiveWithinWindow(exactlyThirtyDaysAgo, 30, NOW)).toBe(true);
  });

  it("returns false for a sign-in one millisecond past the 30-day boundary", () => {
    const justOverThirtyDaysAgo = new Date(
      NOW.getTime() - 30 * 24 * 60 * 60 * 1000 - 1,
    ).toISOString();
    expect(isActiveWithinWindow(justOverThirtyDaysAgo, 30, NOW)).toBe(false);
  });

  it("returns true for a sign-in yesterday", () => {
    const yesterday = new Date(NOW.getTime() - 24 * 60 * 60 * 1000).toISOString();
    expect(isActiveWithinWindow(yesterday, 30, NOW)).toBe(true);
  });

  it("returns false for a sign-in 90 days ago", () => {
    const ninetyDaysAgo = new Date(NOW.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
    expect(isActiveWithinWindow(ninetyDaysAgo, 30, NOW)).toBe(false);
  });

  it("respects a custom window", () => {
    const eightDaysAgo = new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
    expect(isActiveWithinWindow(eightDaysAgo, 7, NOW)).toBe(false);
    expect(isActiveWithinWindow(eightDaysAgo, 14, NOW)).toBe(true);
  });
});

describe("buildDailyDateBuckets", () => {
  it("returns exactly `days` entries, oldest first, ending on today (UTC)", () => {
    const buckets = buildDailyDateBuckets(5, NOW);
    expect(buckets).toEqual([
      "2026-08-09",
      "2026-08-10",
      "2026-08-11",
      "2026-08-12",
      "2026-08-13",
    ]);
  });

  it("defaults to the 30-day window", () => {
    expect(buildDailyDateBuckets(ADMIN_STATS_WINDOW_DAYS, NOW)).toHaveLength(30);
  });

  it("has no duplicate dates and no gaps", () => {
    const buckets = buildDailyDateBuckets(30, NOW);
    expect(new Set(buckets).size).toBe(30);
    for (let i = 1; i < buckets.length; i++) {
      const prev = new Date(`${buckets[i - 1]}T00:00:00.000Z`).getTime();
      const curr = new Date(`${buckets[i]}T00:00:00.000Z`).getTime();
      expect(curr - prev).toBe(24 * 60 * 60 * 1000);
    }
  });
});

describe("computeStatsWindowStartIso", () => {
  it("matches the first bucket's own start-of-day instant", () => {
    expect(computeStatsWindowStartIso(5, NOW)).toBe("2026-08-09T00:00:00.000Z");
  });
});

describe("buildDailyCountSeries", () => {
  it("zero-fills every bucket, not just the ones with data (staggered fixture, not a flat total)", () => {
    // Signups spread unevenly: 3 on day 1, none on day 2 or 3, 1 on day 4,
    // 2 on the last day -- a real trend shape, not a single instantaneous
    // count.
    const timestamps = [
      "2026-08-09T08:00:00.000Z",
      "2026-08-09T12:00:00.000Z",
      "2026-08-09T23:59:00.000Z",
      "2026-08-12T03:00:00.000Z",
      "2026-08-13T00:00:01.000Z",
      "2026-08-13T14:00:00.000Z",
    ];
    expect(buildDailyCountSeries(timestamps, 5, NOW)).toEqual([
      { date: "2026-08-09", value: 3 },
      { date: "2026-08-10", value: 0 },
      { date: "2026-08-11", value: 0 },
      { date: "2026-08-12", value: 1 },
      { date: "2026-08-13", value: 2 },
    ]);
  });

  it("ignores a timestamp outside the requested window", () => {
    const timestamps = ["2026-08-01T00:00:00.000Z", "2026-08-13T00:00:00.000Z"];
    const series = buildDailyCountSeries(timestamps, 5, NOW);
    const total = series.reduce((sum, p) => sum + p.value, 0);
    expect(total).toBe(1);
  });

  it("returns all-zero buckets for an empty input, never an empty array", () => {
    const series = buildDailyCountSeries([], 5, NOW);
    expect(series).toHaveLength(5);
    expect(series.every((p) => p.value === 0)).toBe(true);
  });
});

describe("buildDailySumSeries", () => {
  it("sums per bucket across a genuinely staggered fixture", () => {
    const entries = [
      { timestamp: "2026-08-09T08:00:00.000Z", amount: 50 },
      { timestamp: "2026-08-09T20:00:00.000Z", amount: 25.5 },
      { timestamp: "2026-08-11T10:00:00.000Z", amount: 10 },
      { timestamp: "2026-08-13T10:00:00.000Z", amount: 100 },
    ];
    expect(buildDailySumSeries(entries, 5, NOW)).toEqual([
      { date: "2026-08-09", value: 75.5 },
      { date: "2026-08-10", value: 0 },
      { date: "2026-08-11", value: 10 },
      { date: "2026-08-12", value: 0 },
      { date: "2026-08-13", value: 100 },
    ]);
  });

  it("rounds each bucket to 2 decimal places", () => {
    const entries = [
      { timestamp: "2026-08-13T10:00:00.000Z", amount: 10.111 },
      { timestamp: "2026-08-13T11:00:00.000Z", amount: 0.001 },
    ];
    const series = buildDailySumSeries(entries, 1, NOW);
    expect(series[0].value).toBe(10.11);
  });
});

describe("computeOffreTypeBreakdown", () => {
  it("aggregates montant and count per type across a mixed fixture, sorted descending by montant", () => {
    const entries: { type: "video" | "don" | "whatsapp"; montant: number }[] = [
      { type: "don", montant: 5 },
      { type: "video", montant: 40 },
      { type: "don", montant: 15 },
      { type: "whatsapp", montant: 20 },
      { type: "video", montant: 10 },
    ];
    expect(computeOffreTypeBreakdown(entries)).toEqual([
      { type: "video", montant: 50, count: 2 },
      { type: "don", montant: 20, count: 2 },
      { type: "whatsapp", montant: 20, count: 1 },
    ]);
  });

  it("omits a type with zero activity entirely rather than a zero-length bar", () => {
    const breakdown = computeOffreTypeBreakdown([{ type: "don", montant: 5 }]);
    expect(breakdown.map((b) => b.type)).toEqual(["don"]);
  });

  it("returns an empty array for no activity at all", () => {
    expect(computeOffreTypeBreakdown([])).toEqual([]);
  });

  it("rounds accumulated montant to 2 decimal places", () => {
    const entries: { type: "don"; montant: number }[] = [
      { type: "don", montant: 10.111 },
      { type: "don", montant: 0.001 },
    ];
    expect(computeOffreTypeBreakdown(entries)[0].montant).toBe(10.11);
  });
});
