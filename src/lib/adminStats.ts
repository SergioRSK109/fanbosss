import type { OffreType } from "@/lib/validation";

// Pure helpers behind /admin's "Vue d'ensemble" time-series charts. Same
// reasoning as campagnes.ts/classementProgres.ts/litiges.ts: this project
// has no jsdom/testing-library, so the chart components themselves can't
// be rendered in a test -- the actual bucketing/aggregation logic lives
// here instead, unit-testable directly, so it can never silently disagree
// with what a chart renders.

// The one window this whole feature is built around -- "actif" means
// "signed in within this many days", every daily chart covers this many
// days. A single source of truth so a future session extending this
// dashboard doesn't introduce a second, differently-worded "30 days"
// somewhere else. See CLAUDE.md's own section on this feature for why 30
// (matches every other "last N days" rolling window already established
// elsewhere in this project -- classement views, the parrainage bonus
// window, wallet buckets -- rather than inventing a new one).
export const ADMIN_STATS_WINDOW_DAYS = 30;

// "Actif" = signed in within the rolling window, computed as a plain
// `now - N*24h` interval -- matches this project's own established
// `now() - interval 'N days'` convention (see classement_volume,
// mes_progres_classement, parrainages' own 30-day bonus window) rather
// than a calendar-day cutoff, which would behave differently depending on
// what time of day "today" is. A null last_sign_in_at (never
// authenticated past their initial signup, or a legacy/service account)
// is never active -- there's no sign-in event to measure against.
export function isActiveWithinWindow(
  lastSignInAt: string | null,
  windowDays: number = ADMIN_STATS_WINDOW_DAYS,
  now: Date = new Date(),
): boolean {
  if (!lastSignInAt) {
    return false;
  }
  const cutoff = now.getTime() - windowDays * 24 * 60 * 60 * 1000;
  return new Date(lastSignInAt).getTime() >= cutoff;
}

export interface DailyPoint {
  /** UTC calendar date, "YYYY-MM-DD". */
  date: string;
  value: number;
}

function toUTCDateKey(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

// `days` consecutive UTC calendar dates, oldest first, ending on today
// (UTC) -- computed in UTC for the same reason as every other
// current_date-adjacent computation in this project (the signup age
// gate, litiges' business-day count): a local-timezone cutoff could shift
// which day a near-midnight event lands in depending on the admin's own
// browser timezone, which would make the chart disagree with the
// database's own UTC session. Zero-filled by construction (every date in
// this range is a real bucket) -- a genuinely quiet day must still appear
// on the chart as 0, not a silently skipped gap that would make the line
// jump straight over it.
export function buildDailyDateBuckets(
  days: number,
  now: Date = new Date(),
): string[] {
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const result: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    result.push(new Date(todayUTC - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  }
  return result;
}

// The earliest bucket's own start-of-day instant, as an ISO string --
// the single source of truth for both the chart's own bucket range AND
// the `.gte(...)` threshold a caller uses to fetch the underlying rows,
// so the two can never drift apart (a query threshold computed
// separately, e.g. `now - 30*24h` exactly, would not line up with the
// UTC calendar-day bucket boundaries above and could silently drop or
// double-count rows right at the edge).
export function computeStatsWindowStartIso(
  days: number = ADMIN_STATS_WINDOW_DAYS,
  now: Date = new Date(),
): string {
  return `${buildDailyDateBuckets(days, now)[0]}T00:00:00.000Z`;
}

// Generic day-bucketed COUNT series -- e.g. new signups/day,
// publications/day. Timestamps outside the bucket range are silently
// ignored (not an error): a caller is expected to have already scoped
// its own query to the same window via computeStatsWindowStartIso, this
// is just defensive rather than a second source of truth to keep in
// sync.
export function buildDailyCountSeries(
  timestamps: string[],
  days: number = ADMIN_STATS_WINDOW_DAYS,
  now: Date = new Date(),
): DailyPoint[] {
  const buckets = buildDailyDateBuckets(days, now);
  const counts = new Map<string, number>();
  for (const ts of timestamps) {
    const key = toUTCDateKey(ts);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return buckets.map((date) => ({ date, value: counts.get(date) ?? 0 }));
}

// Generic day-bucketed SUM series -- e.g. GMV/day, commission perçue/day.
// Rounded to cents (2dp) per bucket, same "never let float accumulation
// show as 82.60000000000001" discipline as calculerRepartitionPaiement's
// own round2.
export function buildDailySumSeries(
  entries: { timestamp: string; amount: number }[],
  days: number = ADMIN_STATS_WINDOW_DAYS,
  now: Date = new Date(),
): DailyPoint[] {
  const buckets = buildDailyDateBuckets(days, now);
  const sums = new Map<string, number>();
  for (const { timestamp, amount } of entries) {
    const key = toUTCDateKey(timestamp);
    sums.set(key, (sums.get(key) ?? 0) + amount);
  }
  return buckets.map((date) => ({
    date,
    value: Math.round((sums.get(date) ?? 0) * 100) / 100,
  }));
}

export interface OffreTypeBreakdownEntry {
  type: OffreType;
  montant: number;
  count: number;
}

// Répartition par type d'offre -- montant (not a raw transaction count),
// since this lives in the page's "Argent" section: the question it
// answers is "where does the money come from", not "which button gets
// clicked most" (a count-based version would be a different, Activité-
// shaped question, out of this feature's scope). Sorted descending by
// montant -- this feeds a "compare magnitude" bar chart, not an identity
// comparison, so a fixed/stable order isn't needed the way a categorical
// legend would require. A type with zero activity in the window is
// omitted entirely rather than shown as a zero-length bar -- an empty bar
// among up to 8 possible types adds noise, not information.
export function computeOffreTypeBreakdown(
  entries: { type: OffreType; montant: number }[],
): OffreTypeBreakdownEntry[] {
  const byType = new Map<OffreType, { montant: number; count: number }>();
  for (const { type, montant } of entries) {
    const current = byType.get(type) ?? { montant: 0, count: 0 };
    current.montant += montant;
    current.count += 1;
    byType.set(type, current);
  }
  return [...byType.entries()]
    .map(([type, { montant, count }]) => ({
      type,
      montant: Math.round(montant * 100) / 100,
      count,
    }))
    .sort((a, b) => b.montant - a.montant);
}
