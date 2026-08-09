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
