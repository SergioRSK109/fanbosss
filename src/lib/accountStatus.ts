import type { SupabaseClient } from "@supabase/supabase-js";

// Account suspension/ban (migration 0052): a normal, self-only read of
// the caller's own users row -- users_select_self RLS (id = auth.uid())
// already lets an authenticated caller read every column of their own
// row, statut_compte/statut_compte_raison included, no service-role
// client needed here.
export type StatutCompteBloque = "suspendu" | "banni";

export interface AccountBlockInfo {
  statutCompte: StatutCompteBloque;
  raison: string | null;
}

// Returns null both for a logged-out visitor (nothing to check) and for
// a genuinely active account -- the two "nothing to block" cases share
// one return value on purpose, since every call site's own branching is
// just "is there a block to show or not", never "why isn't there one".
export async function getAccountBlockInfo(
  supabase: SupabaseClient,
  userId: string,
): Promise<AccountBlockInfo | null> {
  const { data } = await supabase
    .from("users")
    .select("statut_compte, statut_compte_raison")
    .eq("id", userId)
    .single();

  if (!data || data.statut_compte === "actif") {
    return null;
  }

  return {
    statutCompte: data.statut_compte as StatutCompteBloque,
    raison: data.statut_compte_raison,
  };
}
