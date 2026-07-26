// Créateur verification (migration 0023) -- shared constants/labels
// between the /parametres request form and the /admin review UI.

export const PLATEFORMES_VERIFICATION = ["tiktok", "instagram", "youtube"] as const;
export type PlateformeVerification = (typeof PLATEFORMES_VERIFICATION)[number];

export const PLATEFORME_LABELS: Record<PlateformeVerification, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
};

export type StatutVerification = "en_attente" | "conflit" | "approuve" | "refuse";

export const STATUT_VERIFICATION_LABELS: Record<StatutVerification, string> = {
  en_attente: "En attente de vérification",
  conflit: "En conflit -- vérification manuelle requise",
  approuve: "Vérifié",
  refuse: "Refusée",
};
