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

export interface ConcoursOrganise {
  concoursId: string;
  nom: string;
  dateFin: string;
  organisateurId: string;
  participants: { createurId: string; displayName: string | null; montantCollecte: number }[];
}

export interface InvitationConcours {
  concoursId: string;
  nom: string;
  dateFin: string;
  organisateurDisplayName: string | null;
}

// Phase 1-bis: the /offres "Concours" tab needs two créateur-only lists
// -- concours the caller organizes or has already accepted
// ("mesConcours") and invitations still awaiting a decision
// ("invitations"). Both start from concours_participants filtered to
// the caller's own rows -- readable directly since migration 0046 added
// concours_participants_select_own (createur_id = auth.uid()), the same
// "self-only SELECT on an otherwise RPC-only table" precedent as
// reservations_stock_select_own (physical products, migration 0039).
//
// Display data (nom/date_fin/organisateur, and the full accepted roster
// for "mesConcours") is then read from concours_publics rather than the
// raw `concours` table -- no new policy needed there at all: since
// creer_concours() always auto-accepts the organizer in the same
// transaction, concours_publics always has at least the organizer's own
// row for any concours that exists, including one the caller has only
// been invited to and not yet accepted.
export async function getConcoursGereesEtInvitations(userId: string): Promise<{
  mesConcours: ConcoursOrganise[];
  invitations: InvitationConcours[];
}> {
  const supabase = await createSupabaseServerClient();

  const { data: mesParticipations } = await supabase
    .from("concours_participants")
    .select("concours_id, invite_statut")
    .eq("createur_id", userId);

  if (!mesParticipations || mesParticipations.length === 0) {
    return { mesConcours: [], invitations: [] };
  }

  const mesIds = mesParticipations
    .filter((p) => p.invite_statut === "accepte")
    .map((p) => p.concours_id);
  const invitationIds = mesParticipations
    .filter((p) => p.invite_statut === "invite")
    .map((p) => p.concours_id);

  const allIds = Array.from(new Set([...mesIds, ...invitationIds]));
  if (allIds.length === 0) {
    return { mesConcours: [], invitations: [] };
  }

  const { data: rows } = await supabase
    .from("concours_publics")
    .select(
      "concours_id, nom, date_fin, organisateur_id, createur_id, montant_collecte, pseudo, nom_affichage",
    )
    .in("concours_id", allIds);

  const rowsByConcoursId = new Map<string, NonNullable<typeof rows>>();
  for (const row of rows ?? []) {
    const existing = rowsByConcoursId.get(row.concours_id);
    if (existing) {
      existing.push(row);
    } else {
      rowsByConcoursId.set(row.concours_id, [row]);
    }
  }

  const mesConcours: ConcoursOrganise[] = mesIds
    .map((id) => rowsByConcoursId.get(id))
    .filter((group): group is NonNullable<typeof rows> => Boolean(group && group.length > 0))
    .map((group) => ({
      concoursId: group[0].concours_id,
      nom: group[0].nom,
      dateFin: group[0].date_fin,
      organisateurId: group[0].organisateur_id,
      participants: group.map((row) => ({
        createurId: row.createur_id,
        displayName: resolveDisplayName(row.nom_affichage, row.pseudo),
        montantCollecte: row.montant_collecte,
      })),
    }));

  const invitations: InvitationConcours[] = invitationIds
    .map((id) => rowsByConcoursId.get(id))
    .filter((group): group is NonNullable<typeof rows> => Boolean(group && group.length > 0))
    .map((group) => {
      const organisateurRow = group.find((row) => row.createur_id === group[0].organisateur_id);
      return {
        concoursId: group[0].concours_id,
        nom: group[0].nom,
        dateFin: group[0].date_fin,
        organisateurDisplayName: organisateurRow
          ? resolveDisplayName(organisateurRow.nom_affichage, organisateurRow.pseudo)
          : null,
      };
    });

  return { mesConcours, invitations };
}
