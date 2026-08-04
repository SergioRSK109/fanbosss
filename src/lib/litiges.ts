// SLA tracking for disputed deliveries (litiges), per the 15-business-day
// commitment in the CGU (article 6.3). Pure functions, same reasoning as
// campagnes.ts/classementProgres.ts: this project has no jsdom/
// testing-library, so LitigesManager.tsx itself can't be rendered in a
// test -- the age/urgency computation is extracted here instead, so it's
// unit-testable directly and can never silently disagree with what the
// component renders.

// Counts business days (Mon-Fri, no holiday calendar -- the CGU
// commitment itself is stated in plain "jours ouvrables", not against any
// specific holiday list) strictly AFTER the calendar day of contestation,
// through today, inclusive. A dispute filed today is 0 elapsed business
// days regardless of the time of day; a dispute filed yesterday (a
// weekday) is 1 the next weekday. Computed in UTC, matching this
// project's existing "current_date is evaluated in the database's UTC
// session" convention (see the signup age-gate helpers in
// src/lib/validation.ts) -- a local-timezone comparison could shift the
// count by a day right around midnight for a visitor/admin near the
// boundary.
//
// Nullable input, same shape as computeJoursRestants (campagnes.ts):
// conteste_at is a new, nullable column (migration 0042) -- a litige
// disputed before that migration shipped has no real dispute timestamp
// to compute from, and null-in-null-out lets the caller render "no
// badge" for that case rather than a fabricated number.
export function computeJoursOuvrablesEcoules(
  contesteAt: string | null,
  now: Date = new Date(),
): number | null {
  if (!contesteAt) {
    return null;
  }
  const start = new Date(contesteAt);
  const cursor = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + 1),
  );
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  let count = 0;
  while (cursor <= end) {
    const day = cursor.getUTCDay(); // 0 = Sunday, 6 = Saturday
    if (day !== 0 && day !== 6) {
      count++;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

export type LitigeUrgence = "normal" | "attention" | "retard";

// Per the brief exactly: normal under 10 business days, attention between
// 10 and 15 inclusive, retard (the CGU's 15-business-day commitment is no
// longer held) past 15. Nullable in, nullable out -- same reasoning as
// computeJoursOuvrablesEcoules above; a litige with no known conteste_at
// gets no urgency verdict at all, not a default "normal" that would
// misrepresent an unknown age as a known-good one.
export function computeLitigeUrgence(
  joursOuvrablesEcoules: number | null,
): LitigeUrgence | null {
  if (joursOuvrablesEcoules === null) {
    return null;
  }
  if (joursOuvrablesEcoules > 15) {
    return "retard";
  }
  if (joursOuvrablesEcoules >= 10) {
    return "attention";
  }
  return "normal";
}
