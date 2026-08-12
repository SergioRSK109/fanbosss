import { describe, expect, it } from "vitest";
import { getAccountBlockInfo } from "@/lib/accountStatus";

function buildSupabase(data: { statut_compte: string; statut_compte_raison: string | null } | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data }),
        }),
      }),
    }),
  };
}

describe("getAccountBlockInfo", () => {
  it("returns null for an active account -- nothing to block", async () => {
    const supabase = buildSupabase({ statut_compte: "actif", statut_compte_raison: null });
    const result = await getAccountBlockInfo(supabase as never, "u1");
    expect(result).toBeNull();
  });

  it("returns null when the row can't be read at all (e.g. deleted user)", async () => {
    const supabase = buildSupabase(null);
    const result = await getAccountBlockInfo(supabase as never, "u1");
    expect(result).toBeNull();
  });

  it("returns the suspended status and reason", async () => {
    const supabase = buildSupabase({
      statut_compte: "suspendu",
      statut_compte_raison: "Contenu inapproprié",
    });
    const result = await getAccountBlockInfo(supabase as never, "u1");
    expect(result).toEqual({ statutCompte: "suspendu", raison: "Contenu inapproprié" });
  });

  it("returns the banned status with a null reason when none was given", async () => {
    const supabase = buildSupabase({ statut_compte: "banni", statut_compte_raison: null });
    const result = await getAccountBlockInfo(supabase as never, "u1");
    expect(result).toEqual({ statutCompte: "banni", raison: null });
  });
});
