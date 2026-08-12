import { describe, expect, it } from "vitest";
import { getAvertissementsNonVus } from "@/lib/avertissements";

function buildSupabase(rows: { id: string; raison: string; emis_at: string }[]) {
  return {
    from: () => ({
      select: () => ({
        is: () => ({
          order: async () => ({ data: rows }),
        }),
      }),
    }),
  };
}

describe("getAvertissementsNonVus", () => {
  it("maps rows to the camelCase shape the banner expects", async () => {
    const supabase = buildSupabase([
      { id: "a1", raison: "Contenu limite", emis_at: "2026-01-01T00:00:00Z" },
    ]);

    const result = await getAvertissementsNonVus(supabase as never);

    expect(result).toEqual([{ id: "a1", raison: "Contenu limite", emisAt: "2026-01-01T00:00:00Z" }]);
  });

  it("returns an empty array when there are no pending avertissements", async () => {
    const supabase = buildSupabase([]);
    const result = await getAvertissementsNonVus(supabase as never);
    expect(result).toEqual([]);
  });
});
