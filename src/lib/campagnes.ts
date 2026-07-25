// Shared by the public profile view and the créateur dashboard so the
// three-way status (active / goal reached / ended) is computed exactly
// once, not re-derived independently in two places that could drift
// apart -- same reasoning as resolveDisplayName/pseudoLockedUntil.
export type CampagneStatus = "active" | "objectif_atteint" | "terminee";

function todayIso(now: Date): string {
  return now.toISOString().slice(0, 10);
}

// dateFin is an ISO "YYYY-MM-DD" string, same shape/comparison approach
// as the signup age gate (isAtLeast18) -- mirrors the DB's own
// `(config->>'date_fin')::date < current_date` comparison exactly (see
// close_expired_campagnes, migration 0017), so the client-side status
// badge never disagrees with what the database actually did.
//
// objectif_atteint is checked independently of the `actif` flag (not
// "actif is false because the goal was reached") so the badge is
// correct even a few seconds before the auto-close trigger has run, and
// terminee covers both date_fin having passed AND any other reason the
// campaign is inactive (e.g. the créateur manually paused it via the
// existing désactiver toggle) -- from a fan's perspective both read the
// same: this campaign isn't accepting contributions right now.
export function computeCampagneStatus(params: {
  actif: boolean;
  montantCollecte: number;
  objectif: number;
  dateFin: string | null;
  now?: Date;
}): CampagneStatus {
  const { actif, montantCollecte, objectif, dateFin, now = new Date() } = params;

  if (objectif > 0 && montantCollecte >= objectif) {
    return "objectif_atteint";
  }
  if (dateFin && dateFin < todayIso(now)) {
    return "terminee";
  }
  if (!actif) {
    return "terminee";
  }
  return "active";
}

export function computeCampagneProgressPercent(
  montantCollecte: number,
  objectif: number,
): number {
  if (!(objectif > 0)) {
    return 0;
  }
  return Math.min(100, Math.max(0, (montantCollecte / objectif) * 100));
}

// Inclusive of dateFin itself (a campaign ending "today" shows 0 jours
// restants, not -1) -- consistent with the DB closing campaigns only
// the day AFTER date_fin (`< current_date`, not `<=`).
export function computeJoursRestants(
  dateFin: string | null,
  now: Date = new Date(),
): number | null {
  if (!dateFin) {
    return null;
  }
  const endOfDay = new Date(`${dateFin}T00:00:00Z`).getTime();
  const today = new Date(`${todayIso(now)}T00:00:00Z`).getTime();
  return Math.ceil((endOfDay - today) / (24 * 60 * 60 * 1000));
}

// Thousands-grouped display for a campaign amount (objectif, montant
// collecté) -- a raw "1205$" is hard to scan for a 4-5 digit goal.
// Shared (rather than reimplemented per call site) so the public
// profile and the créateur dashboard format the exact same way.
// Locale defaults to "fr-FR" since the créateur dashboard is
// French-only by design (see CLAUDE.md's i18n section); the bilingual
// public profile passes next-intl's own active locale explicitly.
export function formatMontant(value: number, locale: string = "fr-FR"): string {
  return new Intl.NumberFormat(locale).format(value);
}
