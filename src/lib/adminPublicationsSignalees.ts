// /admin's "Publications signalées" worklist (Lot 5b, migration 0030) --
// extracted into a pure function so the repost-aware content/label logic
// is unit-testable without a DOM or a real Supabase client, same
// discipline as classifyPaiementRecu()/computeCampagneStatus() elsewhere
// in this codebase.

export interface PublicationSignaleeRow {
  reportId: string;
  // "signalement" or "signalement_automatique" (migration 0054) -- the
  // explicit, real signal for isAutomatique below, never inferred from
  // reporterId's own nullability (which happens to be null only for the
  // automatic case in this schema today, but the type column is what
  // actually means it, the same "explicit flag, never a guess from
  // nullability" discipline peut_voir_publication_complete()'s own
  // contenu_complet already established for a different feature).
  type: string;
  raison: string | null;
  createdAt: string;
  // Null for an automatic signalement -- no real user reported the
  // publication, a report row was inserted directly by
  // signaler_publication_automatique() instead of signaler_publication().
  reporterId: string | null;
  reportedUserId: string;
  // Null only if the publication itself was somehow deleted -- this
  // codebase has no delete path for anything but a repost row, so this
  // is purely defensive.
  publication: { id: string; contenu: string | null; repostDeId: string | null } | null;
}

export interface PublicationOriginalRow {
  id: string;
  contenu: string | null;
  auteurId: string;
}

export interface PublicationSignalee {
  // The REPORTED publication's own id -- the repost's id when the
  // signalement targets a repost, never the original's. This is what
  // the admin actually saw and flagged, and what the permalink must
  // point at (see PublicationsSignaleesManager.tsx).
  id: string;
  // The reported publication's own auteur -- always row.reportedUserId,
  // the same id signaler_publication() itself sets `reported_user_id`
  // to (migration 0030). Added for the account suspension/ban "quick
  // actions" (migration 0052): the admin acts on this account, never the
  // repost-original's author (that's a different, unrelated account).
  auteurId: string;
  // What to display: the original's contenu when the reported
  // publication is a repost (a repost's own contenu is always null --
  // see publications_contenu_coherent), else the publication's own.
  contenu: string;
  // The REPORTED publication's own author's pseudo, for building
  // /@pseudo/p/{id} -- null if that author never set one (no permalink
  // exists under that shape then, see the permalink page's own 404
  // rule).
  pseudo: string | null;
  isRepost: boolean;
  // Only set when isRepost -- "@pseudo" (preferred, since it's what an
  // admin can actually act on) or a display-name fallback for the
  // ORIGINAL's author, for the "Repost de X :" indicator.
  repostOriginalLabel: string | null;
  raison: string | null;
  createdAt: string;
  // "🤖 Modération automatique" (or whatever automatiqueLabel resolves
  // to) when isAutomatique, otherwise the reporting user's real label --
  // never deletedUserLabel for an automatic row, which would misread as
  // "a real user reported this, but their account is gone."
  reporterLabel: string;
  auteurLabel: string;
  // migration 0054 -- true for a report signaler_publication_automatique()
  // inserted (reporterId null, type=signalement_automatique), never
  // inferred from reporterId alone elsewhere in this codebase (a
  // genuinely deleted reporter account is a different, unrelated case
  // this schema doesn't actually produce, since users are never deleted
  // -- but this flag is the real, explicit signal either way, not a
  // guess from nullability).
  isAutomatique: boolean;
}

export function buildPublicationSignalee(
  row: PublicationSignaleeRow,
  originalById: Map<string, PublicationOriginalRow>,
  pseudoById: Map<string, string | null>,
  labelById: Map<string, string>,
  deletedUserLabel: string,
  automatiqueLabel: string,
): PublicationSignalee {
  const { publication } = row;
  const isRepost = Boolean(publication?.repostDeId);
  const original =
    isRepost && publication?.repostDeId ? originalById.get(publication.repostDeId) : undefined;

  const contenu = isRepost ? (original?.contenu ?? "") : (publication?.contenu ?? "");

  let repostOriginalLabel: string | null = null;
  if (isRepost) {
    if (!original) {
      repostOriginalLabel = deletedUserLabel;
    } else {
      const originalPseudo = pseudoById.get(original.auteurId);
      repostOriginalLabel = originalPseudo
        ? `@${originalPseudo}`
        : (labelById.get(original.auteurId) ?? deletedUserLabel);
    }
  }

  const isAutomatique = row.type === "signalement_automatique";

  return {
    id: publication?.id ?? row.reportId,
    auteurId: row.reportedUserId,
    contenu,
    pseudo: publication ? (pseudoById.get(row.reportedUserId) ?? null) : null,
    isRepost,
    repostOriginalLabel,
    raison: row.raison,
    createdAt: row.createdAt,
    reporterLabel: isAutomatique
      ? automatiqueLabel
      : (row.reporterId ? (labelById.get(row.reporterId) ?? deletedUserLabel) : deletedUserLabel),
    auteurLabel: labelById.get(row.reportedUserId) ?? deletedUserLabel,
    isAutomatique,
  };
}
