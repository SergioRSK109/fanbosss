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
    // Concours (either mode) this campagne is an accepted participant
    // in (migration 0047) -- backs the "Fait partie du tournoi [nom]"
    // context mention. Never includes the Maître du jeu percentage --
    // concours_publics deliberately never exposes it.
    concours: { concoursId: string; nom: string }[];
  }[];
  // `produit` (Phase 1: migration 0039, Phase 3: fan-facing UI, this
  // section) is kept out of `offres` above for the same reason
  // `campagnes` is: it needs its own card shape (image, quantity
  // selector, live availability), not a plain price row. `disponible*`/
  // `prochaineLiberation` come straight from offres_disponibilite_produit
  // (migration 0039) -- never computed here, so this page's numbers can
  // never disagree with what reserver_stock_produit() itself enforces.
  produits: {
    id: string;
    libelle: string | null;
    prix: number;
    imageUrl: string | null;
    disponibleMaintenant: number;
    disponibleDefinitif: number;
    prochaineLiberation: string | null;
  }[];
  ranks: {
    volume: number | null;
    reactivite: number | null;
    progression: number | null;
  };
  // Donor badge (migration 0051) -- this profile's OWN cumulative spend
  // tier across every créateur combined, straight from
  // badges_donateur_publics (already filtered to badge_donateur_public =
  // true and a real palier reached -- nothing further to check here).
  // Null whenever the badge is off or no threshold has been reached yet.
  donorPalier: number | null;
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
    { data: produitRows },
    { data: volumeRow },
    { data: reactiviteRow },
    { data: progressionRow },
    { data: supporterRows },
    { data: badgeRows },
    { data: donorBadgeRow },
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
      .neq("type", "campagne")
      .neq("type", "produit"),
    // campagnes_publiques, unlike offres_publiques, is never filtered to
    // actif=true -- see migration 0017 -- so closed campaigns stay in the
    // public history instead of vanishing. genere_pour_concours_id is not
    // null for a synthetic campagne migration 0048's creer_concours()/
    // accepter_invitation_concours() auto-create -- filtered out here so
    // it's never chosen or seen by anyone (per Part A.4); it only ever
    // shows up through /concours/[id]'s own "Participer" button instead.
    supabase
      .from("campagnes_publiques")
      .select("id, libelle, actif, config, created_at, genere_pour_concours_id")
      .eq("createur_id", createurId)
      .is("genere_pour_concours_id", null),
    // Phase 3: produit offres, read separately from the generic `offres`
    // query above for the same "needs its own card shape" reason
    // campagnes already are -- see the field's own comment. Still
    // actif-only via offres_publiques (a sold-out/deactivated produit
    // offer stops being orderable, unlike a campagne's own deliberate
    // "stays visible as history" exception).
    supabase
      .from("offres_publiques")
      .select("id, prix, libelle, image_r2_key")
      .eq("createur_id", createurId)
      .eq("type", "produit"),
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
    // Donor badge (migration 0051) -- this profile's own tier, if opted
    // in and reached. maybeSingle(), not single(): most profiles have no
    // row here at all (opted out, or below the smallest threshold).
    supabase
      .from("badges_donateur_publics")
      .select("palier")
      .eq("user_id", createurId)
      .maybeSingle(),
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

  // Which concours (either mode -- the brief's own "peu importe le
  // mode") this campagne is an ACCEPTED participant in, straight from
  // concours_publics (migration 0045/0047), which already filters to
  // accepted-only. This is what backs the "Fait partie du tournoi [nom]"
  // context mention on the public profile card -- never the
  // pourcentage_maitre_jeu, which concours_publics deliberately never
  // exposes at all (see migration 0047's own comment).
  const { data: concoursLinkRows } =
    campagneIds.length > 0
      ? await supabase
          .from("concours_publics")
          .select("campagne_id, concours_id, nom")
          .in("campagne_id", campagneIds)
      : { data: [] as { campagne_id: string; concours_id: string; nom: string }[] };

  const concoursParCampagne = new Map<string, { concoursId: string; nom: string }[]>();
  for (const row of concoursLinkRows ?? []) {
    const existing = concoursParCampagne.get(row.campagne_id) ?? [];
    existing.push({ concoursId: row.concours_id, nom: row.nom });
    concoursParCampagne.set(row.campagne_id, existing);
  }

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
        concours: concoursParCampagne.get(row.id) ?? [],
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  // Live availability per produit offre, straight from
  // offres_disponibilite_produit (migration 0039) -- same "only fetch
  // when there's something to fetch" discipline as
  // campagnes_montant_collecte above. This is the one and only source of
  // truth for the three-state (en stock/réservé/épuisé) card logic --
  // never re-derived from stock_total here, since that column isn't even
  // exposed publicly.
  const produitIds = (produitRows ?? []).map((row) => row.id);
  const { data: disponibiliteRows } =
    produitIds.length > 0
      ? await supabase
          .from("offres_disponibilite_produit")
          .select("offre_id, disponible_maintenant, disponible_definitif, prochaine_liberation")
          .in("offre_id", produitIds)
      : {
          data: [] as {
            offre_id: string;
            disponible_maintenant: number;
            disponible_definitif: number;
            prochaine_liberation: string | null;
          }[],
        };
  const disponibiliteParOffre = new Map(
    (disponibiliteRows ?? []).map((row) => [row.offre_id, row]),
  );

  const produits = await Promise.all(
    (produitRows ?? []).map(async (row) => {
      const disponibilite = disponibiliteParOffre.get(row.id);
      return {
        id: row.id,
        libelle: row.libelle,
        prix: Number(row.prix),
        imageUrl: row.image_r2_key
          ? await getSignedDownloadUrl(row.image_r2_key, PHOTO_SIGNED_URL_EXPIRY_SECONDS)
          : null,
        disponibleMaintenant: disponibilite?.disponible_maintenant ?? 0,
        disponibleDefinitif: disponibilite?.disponible_definitif ?? 0,
        prochaineLiberation: disponibilite?.prochaine_liberation ?? null,
      };
    }),
  );

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
    produits,
    ranks: {
      volume: volumeRow?.rang ?? null,
      reactivite: reactiviteRow?.rang ?? null,
      progression: progressionRow?.rang ?? null,
    },
    donorPalier: donorBadgeRow?.palier ?? null,
    supporters,
    badgesFidelite,
    publications,
    viewerCanRepost,
    viewerId,
  };
}
