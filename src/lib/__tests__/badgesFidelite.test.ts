import { describe, expect, it } from "vitest";
import { computePremieresTransactionsParPartenaire, formatDepuis } from "@/lib/badgesFidelite";

describe("computePremieresTransactionsParPartenaire", () => {
  it("keeps the earliest date per partner when several transactions exist", () => {
    const result = computePremieresTransactionsParPartenaire([
      { partenaireId: "createur-1", createdAt: "2024-03-01T10:00:00Z" },
      { partenaireId: "createur-1", createdAt: "2024-01-15T10:00:00Z" },
      { partenaireId: "createur-1", createdAt: "2024-02-10T10:00:00Z" },
    ]);

    expect(result.get("createur-1")).toBe("2024-01-15T10:00:00Z");
  });

  it("tracks separate créateurs independently", () => {
    const result = computePremieresTransactionsParPartenaire([
      { partenaireId: "createur-1", createdAt: "2024-01-15T10:00:00Z" },
      { partenaireId: "createur-2", createdAt: "2024-05-01T10:00:00Z" },
    ]);

    expect(result.get("createur-1")).toBe("2024-01-15T10:00:00Z");
    expect(result.get("createur-2")).toBe("2024-05-01T10:00:00Z");
  });

  it("is unaffected by input order", () => {
    const earliest = "2024-01-01T00:00:00Z";
    const result = computePremieresTransactionsParPartenaire([
      { partenaireId: "createur-1", createdAt: "2024-06-01T00:00:00Z" },
      { partenaireId: "createur-1", createdAt: earliest },
      { partenaireId: "createur-1", createdAt: "2024-03-01T00:00:00Z" },
    ]);

    expect(result.get("createur-1")).toBe(earliest);
  });

  it("returns an empty map for no transactions", () => {
    expect(computePremieresTransactionsParPartenaire([]).size).toBe(0);
  });
});

describe("formatDepuis", () => {
  it("formats a French date by default", () => {
    expect(formatDepuis("2024-03-15T00:00:00Z")).toBe("15 mars 2024");
  });

  it("formats an English date when given the en locale", () => {
    expect(formatDepuis("2024-03-15T00:00:00Z", "en")).toBe("March 15, 2024");
  });
});
