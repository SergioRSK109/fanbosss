// Pure helpers for the créateur-only "progress towards the leaderboard"
// card on the dashboard (migration 0019's mes_progres_classement() RPC).
// Kept DOM/database-free and unit-tested, same discipline as
// describeTransactionStatutFan/computeCampagneStatus.

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

function pluralTransactions(count: number): string {
  return `transaction${count > 1 ? "s" : ""} livrée${count > 1 ? "s" : ""}`;
}

export function describeVolumeProgres(manque: number): string {
  if (manque <= 0) {
    return "Tu es dans le top 10 volume ce mois-ci !";
  }
  return `Plus que ${manque} ${pluralTransactions(manque)} pour entrer dans le top 10 volume ce mois-ci.`;
}

export function describeReactiviteProgres(
  actuelleSecondes: number | null,
  manqueSecondes: number | null,
): string {
  if (actuelleSecondes === null) {
    return "Réponds à ta première demande pour voir ta progression réactivité.";
  }
  if (manqueSecondes === null || manqueSecondes <= 0) {
    return "Tu es dans le top 10 réactivité ce mois-ci !";
  }
  return `Réponds en moyenne ${formatDureeSecondes(manqueSecondes)} plus vite pour entrer dans le top 10 réactivité ce mois-ci.`;
}

export function describeProgressionProgres(
  eligible: boolean,
  manque: number | null,
): string {
  if (!eligible) {
    return "Réservé aux comptes de moins de 30 jours.";
  }
  if (manque === null || manque <= 0) {
    return "Tu es dans le top 10 progression ce mois-ci !";
  }
  return `Plus que ${manque} ${pluralTransactions(manque)} pour entrer dans le top 10 progression ce mois-ci.`;
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
