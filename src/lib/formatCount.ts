// Abbreviated view-count formatting (92.6K / 19.8M), shared by
// PublicationTile.tsx (the Explorer grid's view-count overlay). Its own
// small module, no server-only imports -- same reasoning as
// publicationLinks.ts (see that file's own comment): a "use client"
// component importing anything from publications.ts (which pulls in
// next/headers via createSupabaseServerClient) drags that whole module
// graph into the client bundle, a real Turbopack build error already hit
// once in this codebase for exactly this class of mistake.

const THOUSAND = 1_000;
const MILLION = 1_000_000;

// Truncates toward the real count, never rounds up past it -- 999,999
// views must read "999.9K", not a misleading "1.0M" it hasn't reached
// yet, matching the convention every comparable platform (Instagram,
// TikTok) already uses for this exact abbreviation.
function truncateToOneDecimal(value: number): number {
  return Math.floor(value * 10) / 10;
}

export function formatVuesCount(count: number, locale: string): string {
  const safeCount = Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0;

  if (safeCount < THOUSAND) {
    return String(safeCount);
  }

  const isMillions = safeCount >= MILLION;
  const divisor = isMillions ? MILLION : THOUSAND;
  const suffix = isMillions ? "M" : "K";
  const truncated = truncateToOneDecimal(safeCount / divisor);
  const isWholeNumber = truncated % 1 === 0;

  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: isWholeNumber ? 0 : 1,
    maximumFractionDigits: 1,
    useGrouping: false,
  }).format(truncated);

  return `${formatted}${suffix}`;
}
