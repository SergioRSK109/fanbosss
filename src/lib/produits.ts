// Phase 3 of the "produit physique" offer type: pure helpers shared by
// ProduitCard.tsx (the profile-page card) and ProduitCheckoutContent.tsx
// (the /paiement/produit/[offreId] verification page) -- extracted so
// the "which of the three availability states applies" and "how many
// seconds are left on this hold" logic can be unit-tested directly
// (this project has no jsdom/testing-library, so a React component
// itself can't be rendered in a test; pure functions like these are
// what stays testable). Both call sites use the exact same functions
// rather than each re-deriving the same three-way split, so they can
// never silently disagree about which state a given
// disponible_maintenant/disponible_definitif pair represents.

export type DisponibiliteEtat = "en_stock" | "reserve" | "epuise";

// Mirrors offres_disponibilite_produit's own three states exactly (see
// migration 0039): en_stock whenever a NEW reservation could succeed
// right now, reserve when someone else's active hold is the only thing
// blocking a new one (still recoverable once it expires), epuise when
// every unit is a confirmed, permanent sale.
export function computeDisponibiliteEtat(
  disponibleMaintenant: number,
  disponibleDefinitif: number,
): DisponibiliteEtat {
  if (disponibleMaintenant > 0) {
    return "en_stock";
  }
  return disponibleDefinitif > 0 ? "reserve" : "epuise";
}

// ProduitCard's quantity <select> options -- bounded to the real,
// live disponible_maintenant, never a hardcoded cap. Empty when there's
// nothing to sell (the caller is expected not to render a selector at
// all in that case, but this stays a harmless [] rather than throwing).
export function buildQuantiteOptions(disponibleMaintenant: number): number[] {
  if (!Number.isFinite(disponibleMaintenant) || disponibleMaintenant <= 0) {
    return [];
  }
  return Array.from({ length: Math.floor(disponibleMaintenant) }, (_, i) => i + 1);
}

// reserver_stock_produit()'s own hold window (migration 0039) -- kept
// here as the single source of truth for the verification page's
// countdown, rather than a magic number duplicated in the component.
export const RESERVATION_HOLD_SECONDS = 10 * 60;

// Never negative -- once a hold's expire_at has passed, remaining time
// reads as a clean 0, not a confusing negative countdown. Accepts either
// the ISO string the API returns or an already-parsed epoch ms (what the
// countdown's own ref stores between ticks), so callers never need a
// throwaway `new Date(...).getTime()` of their own.
export function computeRemainingSeconds(
  expireAt: string | number,
  nowMs: number = Date.now(),
): number {
  const expireAtMs = typeof expireAt === "number" ? expireAt : new Date(expireAt).getTime();
  return Math.max(0, Math.round((expireAtMs - nowMs) / 1000));
}

// mm:ss, zero-padded -- the countdown's own display format, extracted so
// the exact boundary (e.g. 9s -> "00:09", 61s -> "01:01") is verified
// directly rather than only read off a screenshot.
export function formatCountdown(remainingSeconds: number): string {
  const minutes = String(Math.floor(remainingSeconds / 60)).padStart(2, "0");
  const seconds = String(remainingSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}
