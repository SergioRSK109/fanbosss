import { describe, expect, it } from "vitest";
import { formatExpirationDate } from "@/lib/formatDate";

describe("formatExpirationDate", () => {
  // Verified against Node's actual Intl output rather than assumed --
  // same discipline this project already applies elsewhere (see
  // CLAUDE.md's own note on fr-FR's narrow-no-break-space grouping
  // separator catching a naive test string).
  it("formats day/short-month/year in French", () => {
    expect(formatExpirationDate("2026-08-20T00:00:00.000Z", "fr")).toBe("20 août 2026");
  });

  it("formats day/short-month/year in English", () => {
    expect(formatExpirationDate("2026-08-20T00:00:00.000Z", "en")).toBe("Aug 20, 2026");
  });

  it("is a pure, deterministic function of its two inputs", () => {
    const iso = "2027-01-05T12:00:00.000Z";
    expect(formatExpirationDate(iso, "fr")).toBe(formatExpirationDate(iso, "fr"));
  });
});
