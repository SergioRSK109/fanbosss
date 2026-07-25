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
