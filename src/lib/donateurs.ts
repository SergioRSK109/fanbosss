// Pure, DOM/database-free helpers for the donor badge (migration 0051) --
// same reasoning as campagnes.ts/classementProgres.ts: nothing here needs
// a browser or a real database, so it's unit-testable directly and can
// never silently disagree between whatever renders it.

// Mirrors calculer_palier_donateur()'s own threshold array exactly
// (migration 0051) -- kept here as the single source of truth for the
// icon lookup, not duplicated as a magic list anywhere else.
export const PALIERS_DONATEUR = [10, 50, 100, 150, 250, 500, 1000, 1500, 3000] as const;

const PALIER_ICONS: Record<number, string> = {
  10: "🌱",
  50: "🌟",
  100: "💛",
  150: "💜",
  250: "💎",
  500: "👑",
  1000: "🏅",
  1500: "🥇",
  3000: "🏆",
};

// `palier` always comes straight from badges_donateur_publics, itself
// always one of PALIERS_DONATEUR's own values (calculer_palier_donateur()
// returns max() over that exact array, or NULL -- and a NULL row is
// filtered out of the view entirely, never reaching this function at
// all) -- the fallback below is defensive only, never expected to fire
// in practice.
export function iconForPalierDonateur(palier: number): string {
  return PALIER_ICONS[palier] ?? "🌱";
}
