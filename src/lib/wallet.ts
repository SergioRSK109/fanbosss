// Lot 2b: mirrors demandes_retrait's `montant >= 25` check
// (supabase/migrations/0027_wallet_retraits.sql) -- same "one constant,
// never a hand-copied duplicate" discipline as COMMISSION_PLATEFORME_TAUX
// (src/lib/transactions.ts) and PSEUDO_COOLDOWN_MS
// (src/lib/validation.ts). This is a UX convenience only: the real
// guarantee is the DB CHECK constraint plus demander_retrait()'s own
// server-side re-check, neither of which reads this constant.
export const RETRAIT_MONTANT_MINIMUM = 25;

export interface SoldeWallet {
  enAttenteLivraison: number;
  enLitige: number;
  netARetirer: number;
}

export type PaiementRecuBucket = "en_attente_livraison" | "en_litige" | "disponible" | "rembourse" | "autre";

// Per-transaction classification for /finance's "historique reçu" list --
// deliberately mirrors solde_wallet_createur()'s three SQL buckets
// (supabase/migrations/0027_wallet_retraits.sql) exactly, so a single
// transaction's badge always agrees with which aggregate bucket it's
// counted in above it on the same page. Not the same *code* as the SQL
// (one is a per-row classification, the other a cross-row SUM), but the
// same underlying conditions -- keep both in sync if either changes.
export function classifyPaiementRecu(params: {
  statutPaiement: string | null;
  confirmationFan: string | null;
  litigeResoluAt: string | null;
}): PaiementRecuBucket {
  const { statutPaiement, confirmationFan, litigeResoluAt } = params;

  // No paiements row yet means the transaction never reached 'validee'
  // (still en_attente, or refusee/remboursee before ever being paid out)
  // -- nothing to classify into a wallet bucket, fall back to the raw
  // transaction statut for display.
  if (!statutPaiement) {
    return "autre";
  }
  if (statutPaiement === "initie") {
    return "en_attente_livraison";
  }
  if (statutPaiement === "rembourse") {
    return "rembourse";
  }
  if (statutPaiement === "reussi") {
    if (confirmationFan === "conteste" && !litigeResoluAt) {
      return "en_litige";
    }
    if (confirmationFan === "confirme" || confirmationFan === "non_applicable") {
      return "disponible";
    }
    // confirmationFan === "en_attente" (a video/shoutout still inside its
    // 72h fan-confirmation window, migration 0025): paid successfully but
    // solde_wallet_createur()'s net_a_retirer bucket only counts
    // 'confirme'/'non_applicable', not 'en_attente' -- falls through to
    // "autre" rather than a misleading "disponible" label, exactly
    // mirroring what the SQL formula actually counts.
    return "autre";
  }
  return "autre";
}
