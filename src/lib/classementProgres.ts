// Pure helpers for the créateur-only "progress towards the leaderboard"
// card on the dashboard (migration 0019's mes_progres_classement() RPC).
// Kept DOM/database-free and unit-tested, same discipline as
// describeTransactionStatutFan/computeCampagneStatus. The describe*
// functions below take a translator (next-intl's `t`, or an equivalent
// stand-in in tests) rather than hardcoding French, so the copy can be
// localized -- the messages themselves (with ICU plural rules) live in
// messages/{fr,en}.json under "Dashboard.classementProgres".
export type ProgresTranslator = (key: string, values?: Record<string, string | number>) => string;

export interface ProgresClassement {
  volumeActuel: number;
  volumeSeuilTop10: number | null;
  volumeManque: number;
  reactiviteActuelleSecondes: number | null;
  reactiviteSeuilTop10Secondes: number | null;
  reactiviteManqueSecondes: number | null;
  progressionEligible: boolean;
  progressionActuel: number | null;
  progressionSeuilTop10: number | null;
  progressionManque: number | null;
}

export function describeVolumeProgres(manque: number, t: ProgresTranslator): string {
  if (manque <= 0) {
    return t("volumeQualified");
  }
  return t("volumeGap", { count: manque });
}

export function describeReactiviteProgres(
  actuelleSecondes: number | null,
  manqueSecondes: number | null,
  t: ProgresTranslator,
): string {
  if (actuelleSecondes === null) {
    return t("reactiviteNoData");
  }
  if (manqueSecondes === null || manqueSecondes <= 0) {
    return t("reactiviteQualified");
  }
  return t("reactiviteGap", { duree: formatDureeSecondes(manqueSecondes) });
}

export function describeProgressionProgres(
  eligible: boolean,
  manque: number | null,
  t: ProgresTranslator,
): string {
  if (!eligible) {
    return t("progressionNotEligible");
  }
  if (manque === null || manque <= 0) {
    return t("progressionQualified");
  }
  return t("progressionGap", { count: manque });
}

// Rounds up to the nearest minute -- a gap of a few seconds should never
// display as "0 min", which would look like there's nothing left to do.
export function formatDureeSecondes(seconds: number): string {
  const totalMinutes = Math.max(1, Math.ceil(seconds / 60));
  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}min` : `${hours}h`;
}

// Higher is better (volume/progression): percent of the way from 0 to the
// top-10 threshold. A null/zero threshold means there's no real
// competition for a top-10 spot (fewer than 10 opted-in créateurs) -- full bar.
export function computeProgressPercent(actuel: number, seuil: number | null): number {
  if (seuil === null || seuil <= 0) {
    return 100;
  }
  return Math.max(0, Math.min(100, Math.round((actuel / seuil) * 100)));
}

// Lower is better (réactivité): symmetric to computeProgressPercent but
// inverted, since being *below* the threshold is what qualifies.
export function computeReactiviteProgressPercent(
  actuelleSecondes: number | null,
  seuilSecondes: number | null,
): number {
  if (actuelleSecondes === null) {
    return 0;
  }
  if (seuilSecondes === null || actuelleSecondes <= seuilSecondes) {
    return 100;
  }
  return Math.max(0, Math.min(100, Math.round((seuilSecondes / actuelleSecondes) * 100)));
}
