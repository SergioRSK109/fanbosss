// Pure helpers for the fan loyalty badge (migration 0022). The date
// shown is never stored -- it's always the earliest 'livree' transaction
// between a given fan/créateur pair, computed live, same principle as
// campagnes_montant_collecte (migration 0017).

// Reduces a flat list of delivered transactions down to, per partner
// (a créateur id from the fan's own perspective, or a fan id from a
// créateur's), the earliest transaction date -- used for the private
// dashboard card, which reads the fan's own RLS-visible `transactions`
// rows directly rather than the public badges_fidelite_publics view
// (that view is filtered by badge_fidelite_public, which must never
// gate what a fan sees of their own activity).
export function computePremieresTransactionsParPartenaire(
  transactions: { partenaireId: string; createdAt: string }[],
): Map<string, string> {
  const premieres = new Map<string, string>();
  for (const { partenaireId, createdAt } of transactions) {
    const existing = premieres.get(partenaireId);
    if (!existing || new Date(createdAt).getTime() < new Date(existing).getTime()) {
      premieres.set(partenaireId, createdAt);
    }
  }
  return premieres;
}

export function formatDepuis(iso: string, locale: string = "fr"): string {
  return new Date(iso).toLocaleDateString(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
