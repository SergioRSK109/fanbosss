export const DELAI_ACCEPTATION_VIDEO_HEURES = 24;
export const DELAI_ACCEPTATION_WHATSAPP_HEURES = 48;
export const DELAI_LIVRAISON_VIDEO_HEURES = 48;

// Migration 0018: commission dropped from 20% to 17%, and the platform
// now absorbs frais_agregateur/tva instead of deducting them from the
// créateur -- mirrors create_paiement_on_validation() exactly. Both are
// still computed and returned below (real bookkeeping, stored on every
// paiements row), just no longer subtracted from montantNetCreateur.
export const COMMISSION_PLATEFORME_TAUX = 0.17;
export const FRAIS_AGREGATEUR_TAUX = 0.03;
export const TVA_TAUX = 0.16;

export function calculerRepartitionPaiement(montant: number) {
  const commissionPlateforme = round2(montant * COMMISSION_PLATEFORME_TAUX);
  const fraisAgregateur = round2(montant * FRAIS_AGREGATEUR_TAUX);
  const tva = round2(commissionPlateforme * TVA_TAUX);
  const montantNetCreateur = round2(montant - commissionPlateforme);

  return {
    montantBrut: montant,
    commissionPlateforme,
    fraisAgregateur,
    tva,
    montantNetCreateur,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatDeadline(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export type StatutFanTranslator = (key: string, values?: Record<string, string | number>) => string;

// Human-readable status for a fan's own sent payment (dashboard's
// "Paiements envoyés" list), replacing the raw statut string with real
// text and, where a deadline actually exists, a concrete date/time
// instead of a vague "en attente" -- deadlineAcceptation only applies to
// en_attente, deadlineLivraison only to validee (and only ever set for
// video/shoutout -- every other type moves straight past validee to
// livree, see the transaction lifecycle).
export function describeTransactionStatutFan(
  params: {
    statut: string;
    deadlineAcceptation: string | null;
    deadlineLivraison: string | null;
  },
  t: StatutFanTranslator,
  locale: string,
): string {
  const { statut, deadlineAcceptation, deadlineLivraison } = params;

  switch (statut) {
    case "en_attente":
      return deadlineAcceptation
        ? t("transactionStatut.enAttenteAvecDeadline", {
            date: formatDeadline(deadlineAcceptation, locale),
          })
        : t("transactionStatut.enAttenteSansDeadline");
    case "validee":
      return deadlineLivraison
        ? t("transactionStatut.valideeAvecDeadline", {
            date: formatDeadline(deadlineLivraison, locale),
          })
        : t("transactionStatut.valideeSansDeadline");
    case "livree":
      return t("statutShort.livree");
    case "remboursee":
      return t("statutShort.remboursee");
    case "refusee":
      return t("statutShort.refusee");
    default:
      return statut;
  }
}
