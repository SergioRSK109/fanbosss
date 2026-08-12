import type { SupabaseClient } from "@supabase/supabase-js";

// Admin warning mechanism (migration 0053) -- a plain self-only read,
// same "no destinataire/self parameter needed at all, RLS alone scopes
// it" shape as getNotifications() (src/lib/notifications.ts):
// avertissements_select_own already restricts this to the caller's own
// rows. Oldest-unseen-first, since AvertissementBanner shows them one at
// a time in that order (the brief's own explicit requirement).
export interface AvertissementNonVu {
  id: string;
  raison: string;
  emisAt: string;
}

export async function getAvertissementsNonVus(
  supabase: SupabaseClient,
): Promise<AvertissementNonVu[]> {
  const { data } = await supabase
    .from("avertissements")
    .select("id, raison, emis_at")
    .is("vu_at", null)
    .order("emis_at", { ascending: true });

  return (data ?? []).map((row) => ({
    id: row.id,
    raison: row.raison,
    emisAt: row.emis_at,
  }));
}
