// Fan gallery (Phase 2/4): the data layer only -- no UI, no new API
// route (see CLAUDE.md's own "Physical products"/"Fundraising
// campaigns" sections for the precedent this follows: a page like
// /finance calls its own server-side data function directly). Two
// deliberately separate parts, same discipline as campagnes.ts/
// classementProgres.ts: a pure function testable with in-memory rows,
// and a fetch function doing the actual I/O.
import { computeDateExpirationAcces, isAccesExpire } from "@/lib/contenuDebloque";
import { mediaKindForR2Key, type MediaKind } from "@/lib/mediaExtension";
import type { OffreType } from "@/lib/validation";
import {
  createSupabaseServerClient,
  createSupabaseServiceRoleClient,
} from "@/lib/supabase/server";

export interface GalerieItem {
  transactionId: string;
  createurId: string;
  mediaType: MediaKind;
  deliveredAt: string; // transaction.created_at, ISO
  expiresAt: string | null; // null for video/shoutout, a real date for contenu_debloque
}

// One row per `livree` transaction under consideration, already carrying
// whatever offer-level data the scope rules below need -- built by
// getGalerieFan() below from two batched reads, but kept as its own
// plain-data shape so this function can be exercised directly with rows
// constructed in memory, no Supabase client/mock involved.
export interface GalerieCandidate {
  transactionId: string;
  createurId: string;
  createdAt: string; // transaction.created_at, ISO
  offreType: OffreType | string | null;
  r2Key: string | null; // offre.config.r2_key -- only meaningful for contenu_debloque
  dureeAccesJours: number | null; // offre.config.duree_acces_jours -- only meaningful for contenu_debloque
}

// The exact scope from the brief: video/shoutout (delivered, never
// expires) and contenu_debloque (delivered, not expired, and its own
// file must be a recognized media type -- a PDF/ZIP sale never belongs
// here). Every other offer type (don, whatsapp, produit, evenement_live,
// campagne) is excluded outright, regardless of statut -- there is no
// branch below that could ever admit one, not just a missing case.
export function computeGalerieItems(
  candidates: GalerieCandidate[],
  now: Date = new Date(),
): GalerieItem[] {
  const items: GalerieItem[] = [];

  for (const candidate of candidates) {
    if (candidate.offreType === "video" || candidate.offreType === "shoutout") {
      items.push({
        transactionId: candidate.transactionId,
        createurId: candidate.createurId,
        mediaType: "video",
        deliveredAt: candidate.createdAt,
        expiresAt: null,
      });
      continue;
    }

    if (candidate.offreType === "contenu_debloque") {
      if (isAccesExpire(candidate.createdAt, candidate.dureeAccesJours, now)) {
        continue;
      }
      const mediaType = mediaKindForR2Key(candidate.r2Key);
      if (!mediaType) {
        // No recognized media extension -- a PDF/ZIP/other non-media
        // unlockable file (Phase 1), out of scope for the gallery.
        continue;
      }
      items.push({
        transactionId: candidate.transactionId,
        createurId: candidate.createurId,
        mediaType,
        deliveredAt: candidate.createdAt,
        expiresAt: computeDateExpirationAcces(
          candidate.createdAt,
          candidate.dureeAccesJours,
        ).toISOString(),
      });
    }

    // Every other offreType (don, whatsapp, produit, evenement_live,
    // campagne, or an offer this fan's transaction is somehow missing
    // entirely) is deliberately excluded -- no branch admits it.
  }

  return items.sort(
    (a, b) => new Date(b.deliveredAt).getTime() - new Date(a.deliveredAt).getTime(),
  );
}

// Fetches and assembles a fan's gallery. Two batched reads, never a
// per-item query (N+1):
//
// 1. transactions where fan_id = fanId (and createur_id = options.
//    createurId, when given), statut = 'livree' -- via the caller's own
//    authenticated client; transactions_select_fan (migration 0003)
//    already scopes this to the fan's own rows.
//
// 2. offres.type/config for exactly the offre_ids that step 1 already
//    proved belong to a livree transaction of THIS fan -- via the
//    service-role client, since offres_select_own (migration 0003/0006)
//    is owner-only and a fan reading it directly returns nothing.
//    Deliberately NOT resolved through offres_publiques (the public
//    view /finance's own "Paiements envoyés" query uses for this exact
//    "fan needs a type she can't read directly" situation, see CLAUDE.md
//    -- and the very bug that pattern itself was built to fix): that
//    view filters to actif = true, which would silently drop a
//    legitimately-delivered video/shoutout/contenu_debloque item from
//    the gallery the instant its créateur later deactivates the offer.
//    A fan who already received something keeps it in her gallery
//    regardless of the offer's current listing status -- so this reads
//    the raw offres table instead, restricted to offre_ids already
//    proven safe by step 1. This is the same security shape as
//    content-url/route.ts's own per-item service-role read (re-verify
//    ownership first, only then bypass RLS for the one column that
//    needs it), just applied once per batch instead of once per item --
//    an offre_id supplied directly by a caller is never accepted here.
export async function getGalerieFan(
  fanId: string,
  options?: { createurId?: string },
): Promise<GalerieItem[]> {
  const supabase = await createSupabaseServerClient();

  let transactionsQuery = supabase
    .from("transactions")
    .select("id, createur_id, offre_id, created_at")
    .eq("fan_id", fanId)
    .eq("statut", "livree");

  if (options?.createurId) {
    transactionsQuery = transactionsQuery.eq("createur_id", options.createurId);
  }

  const { data: transactions } = await transactionsQuery;
  const rows = transactions ?? [];

  const offreIds = Array.from(
    new Set(rows.map((row) => row.offre_id).filter((id): id is string => Boolean(id))),
  );

  if (offreIds.length === 0) {
    return [];
  }

  const serviceSupabase = createSupabaseServiceRoleClient();
  const { data: offres } = await serviceSupabase
    .from("offres")
    .select("id, type, config")
    .in("id", offreIds);

  const offreById = new Map(
    (offres ?? []).map((offre) => [
      offre.id as string,
      {
        type: offre.type as OffreType,
        config: offre.config as { r2_key?: string; duree_acces_jours?: number } | null,
      },
    ]),
  );

  const candidates: GalerieCandidate[] = rows.map((row) => {
    const offre = row.offre_id ? offreById.get(row.offre_id) : undefined;
    return {
      transactionId: row.id,
      createurId: row.createur_id,
      createdAt: row.created_at,
      offreType: offre?.type ?? null,
      r2Key: offre?.config?.r2_key ?? null,
      dureeAccesJours: offre?.config?.duree_acces_jours ?? null,
    };
  });

  return computeGalerieItems(candidates);
}
