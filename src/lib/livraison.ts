// Delivery-zone restriction for physical products (offre type
// `produit`, migration 0055) -- a créateur can declare "I only ship
// within my own province" or "...within my own country," so a fan
// outside that zone is warned/blocked before ever reserving stock.
// Pure and DOM/database-free, same reasoning as campagnes.ts/
// classementProgres.ts elsewhere in this codebase: this logic is worth
// unit-testing directly, and the same function has to back both the
// server-rendered checkout page (which decides whether to block) and
// any future surface that might need the identical comparison, so it
// can never silently drift into two slightly different string-matching
// rules.

export type PorteeLivraison = "province" | "pays" | "aucune_restriction" | null;

export interface DeliveryZoneCheck {
  // A real mismatch -- the fan's own declared province/pays doesn't
  // match the créateur's, and both sides actually have a value to
  // compare. This is the only case that should ever stop a checkout.
  blocked: boolean;
  // The fan hasn't filled in the field this créateur's scope depends on
  // -- never a reason to block (there's nothing to compare against, and
  // penalizing an incomplete profile for a decision the fan never made
  // would be the wrong call), but worth a soft, dismissable heads-up so
  // the fan can go check themselves before paying.
  missingFanData: boolean;
}

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

// `NULL`/`'aucune_restriction'` -- current, unrestricted behavior,
// unchanged. Never retroactively blocks a créateur who hasn't
// configured this setting yet (portee_livraison defaults to NULL on
// every existing row).
export function checkDeliveryZone(
  portee: PorteeLivraison,
  fanValue: string | null | undefined,
  createurValue: string | null | undefined,
): DeliveryZoneCheck {
  if (portee === null || portee === "aucune_restriction") {
    return { blocked: false, missingFanData: false };
  }

  if (!fanValue || !fanValue.trim()) {
    return { blocked: false, missingFanData: true };
  }

  // A créateur who selected a scope but has no value of their own for it
  // (e.g. signed up before province/pays were collected) has nothing
  // meaningful to compare against either -- same "never block on
  // missing data" principle, just the other side of the comparison.
  if (!createurValue || !createurValue.trim()) {
    return { blocked: false, missingFanData: false };
  }

  return { blocked: normalize(fanValue) !== normalize(createurValue), missingFanData: false };
}
