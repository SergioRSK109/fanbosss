export const DELAI_ACCEPTATION_VIDEO_HEURES = 24;
export const DELAI_ACCEPTATION_WHATSAPP_HEURES = 48;
export const DELAI_LIVRAISON_VIDEO_HEURES = 48;

export const COMMISSION_PLATEFORME_TAUX = 0.2;
export const FRAIS_AGREGATEUR_TAUX = 0.03;
export const TVA_TAUX = 0.16;

export function calculerRepartitionPaiement(montant: number) {
  const commissionPlateforme = round2(montant * COMMISSION_PLATEFORME_TAUX);
  const fraisAgregateur = round2(montant * FRAIS_AGREGATEUR_TAUX);
  const tva = round2(commissionPlateforme * TVA_TAUX);
  const montantNetCreateur = round2(
    montant - commissionPlateforme - fraisAgregateur - tva,
  );

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
