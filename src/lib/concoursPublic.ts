import { computeLeaderIds, isConcoursEnded } from "@/lib/concours";
import { resolveDisplayName } from "@/lib/profil";
import { getSignedDownloadUrl } from "@/lib/r2";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Not sensitive, still signed rather than a permanent public bucket URL,
// same 24h expiry as every other public-profile photo in this project
// (see profil.ts#PHOTO_SIGNED_URL_EXPIRY_SECONDS).
const PHOTO_SIGNED_URL_EXPIRY_SECONDS = 60 * 60 * 24;

export interface ConcoursParticipant {
  createurId: string;
  campagneId: string;
  montantCollecte: number;
  displayName: string | null;
  pseudo: string | null;
  photoUrl: string | null;
  isLeader: boolean;
}

export interface ConcoursPublicData {
  concoursId: string;
  nom: string;
  dateFin: string;
  organisateurId: string;
  ended: boolean;
  participants: ConcoursParticipant[];
}

// Reads concours_publics (migration 0045) -- already scoped to accepted
// participants only, with montant_collecte read live from
// campagnes_montant_collecte (never recomputed here, see that
// migration's own comment). Returns null when the concours doesn't
// exist at all; since creer_concours() always auto-accepts the
// organizer's own participation in the same call, a real concours can
// never have zero rows here -- there is no "exists but empty" case to
// distinguish from "not found".
export async function getConcoursPublicData(concoursId: string): Promise<ConcoursPublicData | null> {
  const supabase = await createSupabaseServerClient();

  const { data: rows } = await supabase
    .from("concours_publics")
    .select(
      "concours_id, nom, mode, organisateur_id, date_fin, createur_id, campagne_id, montant_collecte, pseudo, nom_affichage, photo_r2_key",
    )
    .eq("concours_id", concoursId);

  if (!rows || rows.length === 0) {
    return null;
  }

  const first = rows[0];

  const photoUrlByKey = new Map<string, string>();
  const keysToSign = Array.from(
    new Set(rows.map((row) => row.photo_r2_key).filter((key): key is string => Boolean(key))),
  );
  await Promise.all(
    keysToSign.map(async (key) => {
      photoUrlByKey.set(key, await getSignedDownloadUrl(key, PHOTO_SIGNED_URL_EXPIRY_SECONDS));
    }),
  );

  const leaderIds = new Set(
    computeLeaderIds(
      rows.map((row) => ({ createurId: row.createur_id, montantCollecte: row.montant_collecte })),
    ),
  );

  return {
    concoursId: first.concours_id,
    nom: first.nom,
    dateFin: first.date_fin,
    organisateurId: first.organisateur_id,
    ended: isConcoursEnded(first.date_fin),
    participants: rows.map((row) => ({
      createurId: row.createur_id,
      campagneId: row.campagne_id,
      montantCollecte: row.montant_collecte,
      displayName: resolveDisplayName(row.nom_affichage, row.pseudo),
      pseudo: row.pseudo,
      photoUrl: row.photo_r2_key ? photoUrlByKey.get(row.photo_r2_key) ?? null : null,
      isLeader: leaderIds.has(row.createur_id),
    })),
  };
}
