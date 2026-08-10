export const DELAI_ACCEPTATION_VIDEO_HEURES = 24;
export const DELAI_ACCEPTATION_WHATSAPP_HEURES = 48;
export const DELAI_LIVRAISON_VIDEO_HEURES = 48;

// Migration 0024: commission dropped from 17% (absorbed frais/tva) to
// 15% HT + TVA (16%) répercutée -- standard marketplace-intermediation
// model. COMMISSION_PLATEFORME_TAUX is now a HT (hors-taxes) rate; tva is
// added on top of it and the HT+TVA total is deducted from the
// créateur's share -- mirrors create_paiement_on_validation() exactly.
// frais_agregateur is unchanged (still absorbed by the platform, never
// passed through) -- only the tva treatment changes here.
export const COMMISSION_PLATEFORME_TAUX = 0.15;
export const FRAIS_AGREGATEUR_TAUX = 0.03;
export const TVA_TAUX = 0.16;

// pourcentageMaitreJeu (migration 0047, concours Phase 2) mirrors
// create_paiement_on_validation()'s own optional 3-way split exactly:
// omitted/null/undefined reproduces the pre-0047 two-way formula
// byte-for-byte (montantMaitreJeu: null, montantNetCreateur unchanged),
// a real percentage computes the Maître du jeu's cut off the
// net-of-commission total and deducts it from the créateur's share --
// never a separate transfer, the same atomic split the SQL trigger
// performs. See CLAUDE.md's "Atomic 3-way payment split" section.
export function calculerRepartitionPaiement(montant: number, pourcentageMaitreJeu?: number | null) {
  const commissionPlateforme = round2(montant * COMMISSION_PLATEFORME_TAUX);
  const fraisAgregateur = round2(montant * FRAIS_AGREGATEUR_TAUX);
  const tva = round2(commissionPlateforme * TVA_TAUX);
  const montantNetTotal = round2(montant - commissionPlateforme - tva);

  const montantMaitreJeu =
    pourcentageMaitreJeu === null || pourcentageMaitreJeu === undefined
      ? null
      : round2(montantNetTotal * (pourcentageMaitreJeu / 100));
  const montantNetCreateur =
    montantMaitreJeu === null ? montantNetTotal : round2(montantNetTotal - montantMaitreJeu);

  return {
    montantBrut: montant,
    commissionPlateforme,
    fraisAgregateur,
    tva,
    montantNetCreateur,
    montantMaitreJeu,
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
// livree, see the transaction lifecycle). confirmationFan/
// deadlineConfirmation (Lot 2a) only ever apply to livree video/shoutout
// transactions awaiting fan confirmation -- see
// supabase/migrations/0025_confirmation_fan_video_shoutout.sql.
export function describeTransactionStatutFan(
  params: {
    statut: string;
    deadlineAcceptation: string | null;
    deadlineLivraison: string | null;
    confirmationFan?: string | null;
    deadlineConfirmation?: string | null;
  },
  t: StatutFanTranslator,
  locale: string,
): string {
  const { statut, deadlineAcceptation, deadlineLivraison, confirmationFan, deadlineConfirmation } =
    params;

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
      if (confirmationFan === "en_attente" && deadlineConfirmation) {
        return t("transactionStatut.livreeEnAttenteConfirmation", {
          date: formatDeadline(deadlineConfirmation, locale),
        });
      }
      if (confirmationFan === "conteste") {
        return t("transactionStatut.livreeConteste");
      }
      return t("statutShort.livree");
    case "remboursee":
      return t("statutShort.remboursee");
    case "refusee":
      return t("statutShort.refusee");
    default:
      return statut;
  }
}
