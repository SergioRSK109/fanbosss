import { getSignedDownloadUrl } from "@/lib/r2";
import { resolveDisplayName } from "@/lib/profil";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const PHOTO_SIGNED_URL_EXPIRY_SECONDS = 60 * 60 * 24; // 24h, matches /explorer and the profile page.

export interface ClassementEntry {
  createurId: string;
  rang: number;
  displayName: string | null;
  pseudo: string | null;
  photoUrl: string | null;
  createurVerifie: boolean;
}

// Public /classement page data: reuses classement_volume/reactivite
// exactly as they already are (migration 0008) -- rank only, never a
// count or amount -- and profils_publics for the display bits
// (photo/pseudo/nom_affichage), the same public view /explorer and
// /@pseudo already read from. No table is queried directly, and no
// column beyond what these views already exposed publicly is ever
// touched here -- see classementPublic.test.ts for the assertion that
// backs this claim.
//
// Deliberately excludes classement_progression: this page dropped its
// Top 10 progression section per explicit instruction (the per-profile
// progression rank badge on CreateurProfileView is unaffected -- that's
// a completely separate query in src/lib/profil.ts). Fetching a table
// this page never renders would be pointless, not just unused code.
export async function getClassementPublicData(): Promise<{
  volume: ClassementEntry[];
  reactivite: ClassementEntry[];
}> {
  const supabase = await createSupabaseServerClient();

  const [{ data: volumeRows }, { data: reactiviteRows }] = await Promise.all([
    supabase
      .from("classement_volume")
      .select("createur_id, rang")
      .lte("rang", 10)
      .order("rang", { ascending: true }),
    supabase
      .from("classement_reactivite")
      .select("createur_id, rang")
      .lte("rang", 10)
      .order("rang", { ascending: true }),
  ]);

  const allIds = Array.from(
    new Set(
      [...(volumeRows ?? []), ...(reactiviteRows ?? [])].map((row) => row.createur_id),
    ),
  );

  const profilesById = new Map<
    string,
    {
      pseudo: string | null;
      nom_affichage: string | null;
      photo_r2_key: string | null;
      createur_verifie: boolean;
    }
  >();

  if (allIds.length > 0) {
    const { data: profils } = await supabase
      .from("profils_publics")
      .select("id, pseudo, nom_affichage, photo_r2_key, createur_verifie")
      .in("id", allIds);

    for (const profil of profils ?? []) {
      profilesById.set(profil.id, profil);
    }
  }

  const photoUrlByKey = new Map<string, string>();
  const keysToSign = Array.from(
    new Set(
      Array.from(profilesById.values())
        .map((p) => p.photo_r2_key)
        .filter((key): key is string => Boolean(key)),
    ),
  );
  await Promise.all(
    keysToSign.map(async (key) => {
      photoUrlByKey.set(key, await getSignedDownloadUrl(key, PHOTO_SIGNED_URL_EXPIRY_SECONDS));
    }),
  );

  function toEntries(rows: { createur_id: string; rang: number }[] | null): ClassementEntry[] {
    return (rows ?? []).map((row) => {
      const profil = profilesById.get(row.createur_id);
      return {
        createurId: row.createur_id,
        rang: row.rang,
        displayName: resolveDisplayName(profil?.nom_affichage ?? null, profil?.pseudo ?? null),
        pseudo: profil?.pseudo ?? null,
        photoUrl: profil?.photo_r2_key ? photoUrlByKey.get(profil.photo_r2_key) ?? null : null,
        createurVerifie: profil?.createur_verifie ?? false,
      };
    });
  }

  return {
    volume: toEntries(volumeRows),
    reactivite: toEntries(reactiviteRows),
  };
}
