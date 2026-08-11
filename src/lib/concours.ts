// Pure helpers for créateur-vs-créateur contests (concours, migration
// 0045) -- kept DOM/database-free and unit-tested, same discipline as
// campagnes.ts/classementProgres.ts: this project has no jsdom/
// testing-library, so a React component can't be rendered in a test;
// the parts of this feature worth testing directly are pure functions
// instead, imported by both the server-rendered page and the client-side
// countdown component so the two can never silently disagree.

export interface ConcoursParticipantAmount {
  createurId: string;
  montantCollecte: number;
}

// A participant is "in the lead" only once at least one contribution has
// actually landed -- with every participant still at 0, highlighting an
// arbitrary one (e.g. the first row) as "leading" would be misleading,
// not informative. Ties (several participants sharing the current max)
// all come back as leaders -- there's no reason to arbitrarily pick one
// when the real numbers are equal. Reused for the final "Vainqueur"
// badge once the contest has ended (see isConcoursEnded) -- a winner is
// simply "whoever is leading once it's over", not a separately computed
// notion.
export function computeLeaderIds(participants: ConcoursParticipantAmount[]): string[] {
  if (participants.length === 0) {
    return [];
  }
  const max = Math.max(...participants.map((p) => p.montantCollecte));
  if (!(max > 0)) {
    return [];
  }
  return participants.filter((p) => p.montantCollecte === max).map((p) => p.createurId);
}

export function isConcoursEnded(dateFin: string, now: Date = new Date()): boolean {
  return now.getTime() >= new Date(dateFin).getTime();
}

// Migration 0048: whether date_debut (purely informative, never a
// technical gate on participation) is still ahead of `now` -- computed
// here, in the data layer, rather than inline in a Server Component's
// JSX, since calling `new Date()`/`Date.now()` directly during render is
// flagged as an impure render call (react-hooks/purity) regardless of
// Server vs Client component.
export function isDateInFuture(date: string, now: Date = new Date()): boolean {
  return new Date(date).getTime() > now.getTime();
}

// The shared-screen split: 2 participants = half each, 3 = a third
// each, N = 1/N each -- always equal, per the brief (this phase has no
// weighting mechanism). A pure percentage rather than a hardcoded CSS
// class list so it's directly unit-testable for an arbitrary N.
export function computeEqualSharePercent(participantCount: number): number {
  if (!(participantCount > 0)) {
    return 0;
  }
  return 100 / participantCount;
}

// Thousands-grouped display for the /concours/[id] leaderboard --
// deliberately a separate function from campagnes.ts's formatMontant()
// despite the identical math (Intl.NumberFormat grouping, no currency
// symbol -- formatMontant never added one either, the "$" a fan used to
// see came entirely from the Concours.montantCollecte message string,
// not from that function). montantCollecte still measures real dollars
// raised internally (nothing about the data changes, see CLAUDE.md) --
// this page just displays that same number as a competitive "points"
// score (1 USD = 1 point, purely cosmetic), which is a different enough
// concept from a campaign's own monetary total that reusing
// formatMontant here would misdescribe what's actually being shown.
export function formatPoints(value: number, locale: string = "fr-FR"): string {
  return new Intl.NumberFormat(locale).format(value);
}

export interface CountdownParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

// Never negative -- a dateFin already in the past reads as all-zero
// rather than a confusing negative countdown, same "clamp at zero"
// convention as computeRemainingSeconds (produits.ts, the stock
// reservation countdown).
export function computeCountdownParts(dateFin: string, now: Date = new Date()): CountdownParts {
  const remainingMs = Math.max(0, new Date(dateFin).getTime() - now.getTime());
  const totalSeconds = Math.floor(remainingMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return { days, hours, minutes, seconds };
}
