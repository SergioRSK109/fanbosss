import { getSignedDownloadUrl } from "@/lib/r2";
import type { OffreType } from "@/lib/validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Profile photos aren't sensitive (brief point 4) -- still served via a
// presigned URL rather than a permanent public bucket URL, for consistency
// with the rest of R2 access, just with a much longer expiry since there's
// no confidentiality need. A fresh URL is minted server-side on every
// profile page view, so staleness isn't a real concern.
const PHOTO_SIGNED_URL_EXPIRY_SECONDS = 60 * 60 * 24; // 24h

export interface CreateurProfileData {
  createurId: string;
  bio: string | null;
  photoUrl: string | null;
  lienReseauSocial: string | null;
  offres: {
    id: string;
    type: OffreType;
    prix: number | null;
    libelle: string | null;
  }[];
  ranks: {
    volume: number | null;
    reactivite: number | null;
    progression: number | null;
  };
}

// Shared by /createur/[id] (canonical, internal) and /@pseudo (public
// alias -- see the [handle] route) so both render the exact same profile.
export async function getCreateurProfileData(
  createurId: string,
): Promise<CreateurProfileData | null> {
  const supabase = await createSupabaseServerClient();

  const [
    { data: profil },
    { data: offres },
    { data: volumeRow },
    { data: reactiviteRow },
    { data: progressionRow },
  ] = await Promise.all([
    supabase
      .from("profils_publics")
      .select("id, bio, photo_r2_key, lien_reseau_social")
      .eq("id", createurId)
      .single(),
    supabase
      .from("offres_publiques")
      .select("id, type, prix, libelle")
      .eq("createur_id", createurId),
    supabase
      .from("classement_volume")
      .select("rang")
      .eq("createur_id", createurId)
      .maybeSingle(),
    supabase
      .from("classement_reactivite")
      .select("rang")
      .eq("createur_id", createurId)
      .maybeSingle(),
    supabase
      .from("classement_progression")
      .select("rang")
      .eq("createur_id", createurId)
      .maybeSingle(),
  ]);

  if (!profil) {
    return null;
  }

  const photoUrl = profil.photo_r2_key
    ? await getSignedDownloadUrl(profil.photo_r2_key, PHOTO_SIGNED_URL_EXPIRY_SECONDS)
    : null;

  return {
    createurId,
    bio: profil.bio,
    photoUrl,
    lienReseauSocial: profil.lien_reseau_social,
    offres: offres ?? [],
    ranks: {
      volume: volumeRow?.rang ?? null,
      reactivite: reactiviteRow?.rang ?? null,
      progression: progressionRow?.rang ?? null,
    },
  };
}
