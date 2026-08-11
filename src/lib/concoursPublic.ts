import { computeLeaderIds, isConcoursEnded, isDateInFuture } from "@/lib/concours";
import { resolveDisplayName } from "@/lib/profil";
import { getSignedDownloadUrl } from "@/lib/r2";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Not sensitive, still signed rather than a permanent public bucket URL,
// same 24h expiry as every other public-profile photo in this project
// (see profil.ts#PHOTO_SIGNED_URL_EXPIRY_SECONDS). Reused for the trophy
// photo (migration 0047) -- same reasoning applies: not confidential,
// just consistently signed per this project's standing R2 policy.
const PHOTO_SIGNED_URL_EXPIRY_SECONDS = 60 * 60 * 24;

export type ConcoursMode = "entre_createurs" | "maitre_du_jeu";

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
  // Purely informative (migration 0048) -- never a technical gate on
  // participation, see CLAUDE.md's "Creator contests -- campagne
  // auto-générée + objectif/temps record" section.
  dateDebut: string | null;
  // Computed here, not inline in the page's JSX -- calling `new Date()`
  // during a Server Component's render is flagged as an impure render
  // call (react-hooks/purity), same reasoning `ended` below already
  // established for date_fin.
  dateDebutAVenir: boolean;
  objectifPoints: number | null;
  tempsRecord: string | null;
  organisateurId: string;
  mode: ConcoursMode;
  trophyPhotoUrl: string | null;
  ended: boolean;
  // Set only once a participant has crossed objectifPoints before the
  // effective deadline (tempsRecord if set, else dateFin) -- rules 1/2
  // from CLAUDE.md's three-rule priority. When set, this participant is
  // THE winner, regardless of `ended` (the brief: "le concours peut
  // afficher le résultat dès cet instant"). When null, the page falls
  // back to the unchanged rule-3 logic (isLeader + ended) below.
  vainqueurObjectifId: string | null;
  vainqueurObjectifAt: string | null;
  participants: ConcoursParticipant[];
}

// Reads concours_publics (migration 0045, restructured to a LEFT JOIN by
// migration 0047 -- see that migration's own comment) and
// concours_vainqueur_objectif (migration 0048, the points-objective
// winner-determination view -- see CLAUDE.md for why this needs a
// chronological reconstruction rather than "who has the highest
// montant_collecte right now"). Returns null when the concours doesn't
// exist at all -- since migration 0047, a real concours can NEVER have
// zero rows in concours_publics regardless of mode: an entre_createurs
// concours still auto-accepts its organizer (creer_concours(),
// unchanged), and a maitre_du_jeu concours -- which has no auto-accepted
// participant at all -- still gets exactly one "phantom" row
// (organizer/nom/date_fin/trophy/objectif columns populated,
// createur_id/campagne_id/pseudo/etc. all NULL) from the LEFT JOIN's own
// driving `concours` row. Those phantom rows are filtered out of
// `participants` below -- they represent "nobody has joined yet", not a
// real participant.
export async function getConcoursPublicData(concoursId: string): Promise<ConcoursPublicData | null> {
  const supabase = await createSupabaseServerClient();

  const [{ data: rows }, { data: vainqueurRows }] = await Promise.all([
    supabase
      .from("concours_publics")
      .select(
        "concours_id, nom, mode, organisateur_id, date_fin, date_debut, objectif_points, temps_record, createur_id, campagne_id, montant_collecte, pseudo, nom_affichage, photo_r2_key, photo_trophee_r2_key",
      )
      .eq("concours_id", concoursId),
    supabase
      .from("concours_vainqueur_objectif")
      .select("createur_id, atteint_a")
      .eq("concours_id", concoursId)
      .maybeSingle(),
  ]);

  if (!rows || rows.length === 0) {
    return null;
  }

  const first = rows[0];
  const participantRows = rows.filter(
    (row): row is typeof row & { createur_id: string; campagne_id: string } =>
      Boolean(row.createur_id && row.campagne_id),
  );

  const photoUrlByKey = new Map<string, string>();
  const keysToSign = Array.from(
    new Set(participantRows.map((row) => row.photo_r2_key).filter((key): key is string => Boolean(key))),
  );
  await Promise.all(
    keysToSign.map(async (key) => {
      photoUrlByKey.set(key, await getSignedDownloadUrl(key, PHOTO_SIGNED_URL_EXPIRY_SECONDS));
    }),
  );

  const trophyPhotoUrl = first.photo_trophee_r2_key
    ? await getSignedDownloadUrl(first.photo_trophee_r2_key, PHOTO_SIGNED_URL_EXPIRY_SECONDS)
    : null;

  const leaderIds = new Set(
    computeLeaderIds(
      participantRows.map((row) => ({ createurId: row.createur_id, montantCollecte: row.montant_collecte })),
    ),
  );

  return {
    concoursId: first.concours_id,
    nom: first.nom,
    dateFin: first.date_fin,
    dateDebut: first.date_debut,
    dateDebutAVenir: Boolean(first.date_debut) && isDateInFuture(first.date_debut as string),
    objectifPoints: first.objectif_points,
    tempsRecord: first.temps_record,
    organisateurId: first.organisateur_id,
    mode: first.mode as ConcoursMode,
    trophyPhotoUrl,
    ended: isConcoursEnded(first.date_fin),
    vainqueurObjectifId: vainqueurRows?.createur_id ?? null,
    vainqueurObjectifAt: vainqueurRows?.atteint_a ?? null,
    participants: participantRows.map((row) => ({
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
  mode: ConcoursMode;
  // Only ever populated for the two parties migration 0047's
  // concours_select_involved RLS policy actually lets read it (the
  // organizer, or an invited/accepted participant) -- see that
  // migration's own comment for why concours_publics itself never
  // exposes this. Null for a mode='entre_createurs' concours, where this
  // field simply doesn't apply.
  pourcentageMaitreJeu: number | null;
  participants: { createurId: string; displayName: string | null; montantCollecte: number }[];
}

export interface InvitationConcours {
  concoursId: string;
  nom: string;
  dateFin: string;
  organisateurDisplayName: string | null;
  mode: ConcoursMode;
  pourcentageMaitreJeu: number | null;
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
// Since migration 0047 (concours_select_involved), "concours I organize"
// is resolved directly against the raw `concours` table instead of only
// ever being discovered through the caller's own concours_participants
// row -- a Maître du jeu organizer is never auto-accepted as a
// participant (see creer_concours_maitre_jeu()'s own comment), so the
// old participation-only discovery would have left an organizer unable
// to see, manage, or invite anyone into their own freshly-created
// maitre_du_jeu concours. This same raw-table read is also what supplies
// mode/pourcentageMaitreJeu for both "mesConcours" (the organizer's own
// split, for their own reference) and "invitations" (the consent
// screen's actual numbers, brief point 7) -- concours_publics
// deliberately never exposes pourcentageMaitreJeu at all (see migration
// 0047's own comment), so this raw-table read is the only legitimate
// path to it.
export async function getConcoursGereesEtInvitations(userId: string): Promise<{
  mesConcours: ConcoursOrganise[];
  invitations: InvitationConcours[];
}> {
  const supabase = await createSupabaseServerClient();

  const [{ data: mesParticipations }, { data: organises }] = await Promise.all([
    supabase
      .from("concours_participants")
      .select("concours_id, invite_statut")
      .eq("createur_id", userId),
    supabase
      .from("concours")
      .select("id, nom, date_fin, mode, pourcentage_maitre_jeu, organisateur_id")
      .eq("organisateur_id", userId),
  ]);

  const accepteIds = (mesParticipations ?? [])
    .filter((p) => p.invite_statut === "accepte")
    .map((p) => p.concours_id);
  const invitationIds = (mesParticipations ?? [])
    .filter((p) => p.invite_statut === "invite")
    .map((p) => p.concours_id);
  const organisedIds = (organises ?? []).map((c) => c.id);

  const mesConcoursIds = Array.from(new Set([...accepteIds, ...organisedIds]));
  const allInvolvedIds = Array.from(new Set([...mesConcoursIds, ...invitationIds]));

  if (allInvolvedIds.length === 0) {
    return { mesConcours: [], invitations: [] };
  }

  // Details (nom/date_fin/mode/pourcentage/organisateur) for every
  // concours the caller organizes, participates in, or is invited to --
  // concours_select_involved (migration 0047) permits all three cases,
  // via the exact same query. Concours the caller already organizes are
  // already in `organises` above; this only needs to cover accepteIds/
  // invitationIds not already covered by that.
  const idsNeedingDetails = allInvolvedIds.filter((id) => !organisedIds.includes(id));
  const { data: extraDetails } =
    idsNeedingDetails.length > 0
      ? await supabase
          .from("concours")
          .select("id, nom, date_fin, mode, pourcentage_maitre_jeu, organisateur_id")
          .in("id", idsNeedingDetails)
      : { data: [] as NonNullable<typeof organises> };

  const detailsById = new Map(
    [...(organises ?? []), ...(extraDetails ?? [])].map((row) => [row.id, row]),
  );

  // Accepted-participant rosters (display name + montant_collecte),
  // still read from concours_publics -- the one place that shape is
  // already assembled, and it's fine to expose here since none of it
  // includes pourcentage_maitre_jeu.
  const { data: participantRows } =
    mesConcoursIds.length > 0
      ? await supabase
          .from("concours_publics")
          .select("concours_id, createur_id, montant_collecte, pseudo, nom_affichage")
          .in("concours_id", mesConcoursIds)
      : { data: [] as { concours_id: string; createur_id: string | null; montant_collecte: number; pseudo: string | null; nom_affichage: string | null }[] };

  const participantsByConcoursId = new Map<
    string,
    { createurId: string; displayName: string | null; montantCollecte: number }[]
  >();
  for (const row of participantRows ?? []) {
    if (!row.createur_id) {
      continue; // phantom row (LEFT JOIN, no accepted participant yet)
    }
    const existing = participantsByConcoursId.get(row.concours_id) ?? [];
    existing.push({
      createurId: row.createur_id,
      displayName: resolveDisplayName(row.nom_affichage, row.pseudo),
      montantCollecte: row.montant_collecte,
    });
    participantsByConcoursId.set(row.concours_id, existing);
  }

  const mesConcours: ConcoursOrganise[] = mesConcoursIds
    .map((id) => detailsById.get(id))
    .filter((details): details is NonNullable<typeof details> => Boolean(details))
    .map((details) => ({
      concoursId: details.id,
      nom: details.nom,
      dateFin: details.date_fin,
      organisateurId: details.organisateur_id,
      mode: details.mode as ConcoursMode,
      pourcentageMaitreJeu: details.pourcentage_maitre_jeu,
      participants: participantsByConcoursId.get(details.id) ?? [],
    }));

  // Organizer display name for invitations -- resolved independently via
  // profils_publics rather than searching for the organizer among
  // concours_publics' own accepted-participant rows (the old approach,
  // which silently depended on the organizer always being an accepted
  // participant themselves -- never true for maitre_du_jeu).
  const organisateurIds = Array.from(
    new Set(
      invitationIds
        .map((id) => detailsById.get(id)?.organisateur_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const { data: organisateurProfils } =
    organisateurIds.length > 0
      ? await supabase
          .from("profils_publics")
          .select("id, pseudo, nom_affichage")
          .in("id", organisateurIds)
      : { data: [] as { id: string; pseudo: string | null; nom_affichage: string | null }[] };
  const organisateurDisplayNameById = new Map(
    (organisateurProfils ?? []).map((row) => [row.id, resolveDisplayName(row.nom_affichage, row.pseudo)]),
  );

  const invitations: InvitationConcours[] = invitationIds
    .map((id) => detailsById.get(id))
    .filter((details): details is NonNullable<typeof details> => Boolean(details))
    .map((details) => ({
      concoursId: details.id,
      nom: details.nom,
      dateFin: details.date_fin,
      organisateurDisplayName: organisateurDisplayNameById.get(details.organisateur_id) ?? null,
      mode: details.mode as ConcoursMode,
      pourcentageMaitreJeu: details.pourcentage_maitre_jeu,
    }));

  return { mesConcours, invitations };
}
