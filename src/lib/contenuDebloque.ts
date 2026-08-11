// Access window for `contenu_debloque` offers: a créateur-configured
// number of days after payment (offres.config.duree_acces_jours),
// default 30 when unset/invalid. Pure, DOM/database-free -- same
// reasoning as campagnes.ts/classementProgres.ts -- so both the
// server-side enforcement (content-url route) and the fan-facing display
// (TransactionActions) compute the exact same expiry from the exact same
// two inputs and can never silently disagree. See CLAUDE.md's own
// "Time-limited access to unlockable content" section for why
// transactions.created_at is the right anchor for this type specifically.

export const CONTENU_DEBLOQUE_DUREE_ACCES_JOURS_DEFAUT = 30;

// A missing, non-numeric, non-finite, or non-positive value all fall
// back to the default -- mirrors the route's own `?? 30` coalesce so the
// two never disagree about what an unset/malformed
// config.duree_acces_jours means.
function resolveDureeAccesJours(dureeAccesJours: number | null | undefined): number {
  if (
    typeof dureeAccesJours === "number" &&
    Number.isFinite(dureeAccesJours) &&
    dureeAccesJours > 0
  ) {
    return dureeAccesJours;
  }
  return CONTENU_DEBLOQUE_DUREE_ACCES_JOURS_DEFAUT;
}

export function computeDateExpirationAcces(
  transactionCreatedAt: string,
  dureeAccesJours?: number | null,
): Date {
  const jours = resolveDureeAccesJours(dureeAccesJours);
  return new Date(new Date(transactionCreatedAt).getTime() + jours * 24 * 60 * 60 * 1000);
}

export function isAccesExpire(
  transactionCreatedAt: string,
  dureeAccesJours?: number | null,
  now: Date = new Date(),
): boolean {
  return computeDateExpirationAcces(transactionCreatedAt, dureeAccesJours).getTime() <= now.getTime();
}
