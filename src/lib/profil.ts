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
  // Resolved display name -- nom_affichage if the créateur set one, else
  // their pseudo, else null (callers fall back to a generic translated
  // label; see CreateurProfileView).
  displayName: string | null;
  bio: string | null;
  photoUrl: string | null;
  // The original signup-time link, kept for manual identity verification
  // only -- deliberately not rendered on the public profile anymore (see
  // socialLinks below, migration 0011).
  lienReseauSocial: string | null;
  socialLinks: {
    tiktok: string | null;
    instagram: string | null;
    youtube: string | null;
    autre: string | null;
  };
  offres: {
    id: string;
    type: OffreType;
    prix: number | null;
    libelle: string | null;
  }[];
  // Fundraising campaigns (type `campagne`) are deliberately kept out of
  // `offres` above and rendered separately -- they need a progress
  // bar/badge/donate flow, not a plain price card, and (unlike every
  // other type) must stay visible here even once actif=false, so they
  // can't come from the same actif-only offres_publiques query.
  campagnes: {
    id: string;
    titre: string;
    description: string;
    objectif: number;
    dateFin: string | null;
    montantCollecte: number;
    actif: boolean;
  }[];
  ranks: {
    volume: number | null;
    reactivite: number | null;
    progression: number | null;
  };
}

// `don` always leads the public offre list, regardless of when the
// créateur set it up relative to their other offres -- the underlying
// query has no ORDER BY, so without this the position would just follow
// whatever order Postgres happens to return, which isn't guaranteed and
// isn't insertion order either once rows are updated. Stable sort:
// everything else keeps its existing relative order.
// nom_affichage takes priority over pseudo -- it's the field a créateur
// explicitly chose as their public display name; pseudo is the technical,
// URL-safe handle, a reasonable second choice but not what most people
// would pick to be called. Empty string is treated the same as null (a
// blank nom_affichage shouldn't shadow a real pseudo).
export function resolveDisplayName(
  nomAffichage: string | null,
  pseudo: string | null,
): string | null {
  return nomAffichage?.trim() || pseudo || null;
}

export function sortOffresDonFirst<T extends { type: OffreType }>(offres: T[]): T[] {
  return [...offres].sort((a, b) => {
    if (a.type === "don" && b.type !== "don") return -1;
    if (b.type === "don" && a.type !== "don") return 1;
    return 0;
  });
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
    { data: campagnesRows },
    { data: volumeRow },
    { data: reactiviteRow },
    { data: progressionRow },
  ] = await Promise.all([
    supabase
      .from("profils_publics")
      .select(
        "id, bio, photo_r2_key, lien_reseau_social, pseudo, nom_affichage, lien_tiktok, lien_instagram, lien_youtube, lien_autre",
      )
      .eq("id", createurId)
      .single(),
    supabase
      .from("offres_publiques")
      .select("id, type, prix, libelle")
      .eq("createur_id", createurId)
      .neq("type", "campagne"),
    // campagnes_publiques, unlike offres_publiques, is never filtered to
    // actif=true -- see migration 0017 -- so closed campaigns stay in the
    // public history instead of vanishing.
    supabase
      .from("campagnes_publiques")
      .select("id, libelle, actif, config, created_at")
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

  const campagneIds = (campagnesRows ?? []).map((row) => row.id);
  // Montant collecté is computed live (never stored) via
  // campagnes_montant_collecte -- see migration 0017 -- so it can't drift
  // out of sync with the transactions it's summed from. Only fetched when
  // there's at least one campaign, since `.in()` with an empty array
  // would otherwise still round-trip for nothing.
  const { data: collecteRows } =
    campagneIds.length > 0
      ? await supabase
          .from("campagnes_montant_collecte")
          .select("offre_id, montant_collecte")
          .in("offre_id", campagneIds)
      : { data: [] as { offre_id: string; montant_collecte: number }[] };

  const montantCollecteParOffre = new Map(
    (collecteRows ?? []).map((row) => [row.offre_id, row.montant_collecte]),
  );

  // Most recent campaign first -- a créateur's history reads naturally
  // with their latest activity on top, matching how the créateur
  // dashboard's video-offres list already appends new entries.
  const campagnes = [...(campagnesRows ?? [])]
    .sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
    .map((row) => {
      const config = row.config as {
        description?: unknown;
        objectif?: unknown;
        date_fin?: unknown;
      };
      const objectif = Number(config.objectif);
      // Defensive, not expected in practice: config is validated at
      // creation time (creerOffreSchema), but this is public-facing
      // rendering code -- a malformed row must never crash the whole
      // profile page for a créateur's other, valid offres.
      if (!Number.isFinite(objectif) || objectif <= 0) {
        return null;
      }
      return {
        id: row.id,
        titre: row.libelle ?? "",
        description: typeof config.description === "string" ? config.description : "",
        objectif,
        dateFin: typeof config.date_fin === "string" ? config.date_fin : null,
        montantCollecte: montantCollecteParOffre.get(row.id) ?? 0,
        actif: row.actif,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  return {
    createurId,
    displayName: resolveDisplayName(profil.nom_affichage, profil.pseudo),
    bio: profil.bio,
    photoUrl,
    lienReseauSocial: profil.lien_reseau_social,
    socialLinks: {
      tiktok: profil.lien_tiktok,
      instagram: profil.lien_instagram,
      youtube: profil.lien_youtube,
      autre: profil.lien_autre,
    },
    offres: sortOffresDonFirst(offres ?? []),
    campagnes,
    ranks: {
      volume: volumeRow?.rang ?? null,
      reactivite: reactiviteRow?.rang ?? null,
      progression: progressionRow?.rang ?? null,
    },
  };
}
