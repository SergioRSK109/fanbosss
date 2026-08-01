import { getPublicationsForAuteur, getViewerContext, type Publication } from "@/lib/publications";
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
  // Set exclusively by approuver_verification() (migration 0023) --
  // never true just because a verification request exists or was
  // submitted; see "Créateur verification" in CLAUDE.md.
  createurVerifie: boolean;
  bio: string | null;
  photoUrl: string | null;
  // Cover/banner photo (migration 0035) -- optional, null renders the
  // existing gradient banner unchanged (see CreateurProfileView).
  couvertureUrl: string | null;
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
  // Fan loyalty badge (migration 0022), both directions -- there's no
  // fan/créateur role split in this app, so the same profile can have
  // both. `supporters`: opted-in fans who support THIS profile as a
  // créateur. `badgesFidelite`: créateurs THIS profile supports as a
  // fan. Both come from badges_fidelite_publics, already filtered to
  // badge_fidelite_public = true -- nothing further to check here.
  // `depuis` is an ISO timestamp, the earliest 'livree' transaction
  // between that specific pair, computed live (never stored).
  supporters: {
    fanId: string;
    displayName: string | null;
    pseudo: string | null;
    depuis: string;
  }[];
  badgesFidelite: {
    createurId: string;
    displayName: string | null;
    pseudo: string | null;
    depuis: string;
  }[];
  // Lot 5a -- this créateur's own publications, teaser-shaped per the
  // current viewer by publications_visibles. Not filtered by this
  // créateur's current verification status (unlike /home's feed) -- see
  // getPublicationsForAuteur's own comment for why.
  publications: Publication[];
  // Lot 5c -- whether the CURRENT viewer (not necessarily this profile's
  // own owner) is a verified créateur or admin, i.e. eligible to repost
  // any of the publications above. Computed once here rather than once
  // per publication -- same getViewerContext() also backs /home's
  // composer/repost eligibility.
  viewerCanRepost: boolean;
  // Migration 0032 -- the current viewer's own id (null if logged out),
  // so each publication's "..." menu can decide "Masquer ma publication"
  // vs. "Signaler"/mute without a second query per card.
  viewerId: string | null;
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
    { data: supporterRows },
    { data: badgeRows },
  ] = await Promise.all([
    supabase
      .from("profils_publics")
      .select(
        "id, bio, photo_r2_key, photo_couverture_r2_key, lien_reseau_social, pseudo, nom_affichage, lien_tiktok, lien_instagram, lien_youtube, lien_autre, createur_verifie",
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
    // Opted-in fans supporting this profile as a créateur.
    supabase
      .from("badges_fidelite_publics")
      .select("fan_id, depuis")
      .eq("createur_id", createurId)
      .order("depuis", { ascending: true }),
    // Créateurs this profile supports as a fan (only non-empty if this
    // user's own badge_fidelite_public is true -- the view is filtered
    // on the fan side regardless of which id we query by).
    supabase
      .from("badges_fidelite_publics")
      .select("createur_id, depuis")
      .eq("fan_id", createurId)
      .order("depuis", { ascending: true }),
  ]);

  if (!profil) {
    return null;
  }

  const photoUrl = profil.photo_r2_key
    ? await getSignedDownloadUrl(profil.photo_r2_key, PHOTO_SIGNED_URL_EXPIRY_SECONDS)
    : null;
  const couvertureUrl = profil.photo_couverture_r2_key
    ? await getSignedDownloadUrl(profil.photo_couverture_r2_key, PHOTO_SIGNED_URL_EXPIRY_SECONDS)
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

  // Resolve pseudo/nom_affichage for whichever other users show up on
  // either side of the badge lists -- a second, dependent query (needs
  // supporterRows/badgeRows' ids first), same "only fetch when there's
  // something to fetch" discipline as campagnes_montant_collecte above.
  const supporterFanIds = (supporterRows ?? []).map((row) => row.fan_id);
  const badgeCreateurIds = (badgeRows ?? []).map((row) => row.createur_id);
  const otherProfileIds = Array.from(new Set([...supporterFanIds, ...badgeCreateurIds]));

  const { data: otherProfiles } =
    otherProfileIds.length > 0
      ? await supabase
          .from("profils_publics")
          .select("id, pseudo, nom_affichage")
          .in("id", otherProfileIds)
      : { data: [] as { id: string; pseudo: string | null; nom_affichage: string | null }[] };

  const otherProfilesById = new Map((otherProfiles ?? []).map((p) => [p.id, p]));

  const supporters = (supporterRows ?? []).map((row) => {
    const p = otherProfilesById.get(row.fan_id);
    return {
      fanId: row.fan_id,
      displayName: resolveDisplayName(p?.nom_affichage ?? null, p?.pseudo ?? null),
      pseudo: p?.pseudo ?? null,
      depuis: row.depuis,
    };
  });

  const badgesFidelite = (badgeRows ?? []).map((row) => {
    const p = otherProfilesById.get(row.createur_id);
    return {
      createurId: row.createur_id,
      displayName: resolveDisplayName(p?.nom_affichage ?? null, p?.pseudo ?? null),
      pseudo: p?.pseudo ?? null,
      depuis: row.depuis,
    };
  });

  const publications = await getPublicationsForAuteur(createurId);
  const { viewerId, canManagePublications: viewerCanRepost } = await getViewerContext(supabase);

  return {
    createurId,
    displayName: resolveDisplayName(profil.nom_affichage, profil.pseudo),
    createurVerifie: profil.createur_verifie,
    bio: profil.bio,
    photoUrl,
    couvertureUrl,
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
    supporters,
    badgesFidelite,
    publications,
    viewerCanRepost,
    viewerId,
  };
}
