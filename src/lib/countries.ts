// Broad country + dial-code list for the signup phone field (brief point
// 5). Not limited to Francophone Africa -- fans/créateurs in countries
// where the service isn't live yet should still be able to sign up, ahead
// of the multi_devise_actif feature flag.
export interface Country {
  code: string;
  name: string;
  dial: string;
}

export const COUNTRIES: Country[] = [
  { code: "CD", name: "RD Congo", dial: "+243" },
  { code: "CI", name: "Côte d'Ivoire", dial: "+225" },
  { code: "SN", name: "Sénégal", dial: "+221" },
  { code: "CM", name: "Cameroun", dial: "+237" },
  { code: "BJ", name: "Bénin", dial: "+229" },
  { code: "BF", name: "Burkina Faso", dial: "+226" },
  { code: "TG", name: "Togo", dial: "+228" },
  { code: "ML", name: "Mali", dial: "+223" },
  { code: "NE", name: "Niger", dial: "+227" },
  { code: "GN", name: "Guinée", dial: "+224" },
  { code: "GA", name: "Gabon", dial: "+241" },
  { code: "CG", name: "Congo-Brazzaville", dial: "+242" },
  { code: "RW", name: "Rwanda", dial: "+250" },
  { code: "BI", name: "Burundi", dial: "+257" },
  { code: "MG", name: "Madagascar", dial: "+261" },
  { code: "GH", name: "Ghana", dial: "+233" },
  { code: "NG", name: "Nigéria", dial: "+234" },
  { code: "KE", name: "Kenya", dial: "+254" },
  { code: "UG", name: "Ouganda", dial: "+256" },
  { code: "TZ", name: "Tanzanie", dial: "+255" },
  { code: "ZA", name: "Afrique du Sud", dial: "+27" },
  { code: "ET", name: "Éthiopie", dial: "+251" },
  { code: "MA", name: "Maroc", dial: "+212" },
  { code: "DZ", name: "Algérie", dial: "+213" },
  { code: "TN", name: "Tunisie", dial: "+216" },
  { code: "EG", name: "Égypte", dial: "+20" },
  { code: "FR", name: "France", dial: "+33" },
  { code: "BE", name: "Belgique", dial: "+32" },
  { code: "CH", name: "Suisse", dial: "+41" },
  { code: "CA", name: "Canada", dial: "+1" },
  { code: "US", name: "États-Unis", dial: "+1" },
  { code: "GB", name: "Royaume-Uni", dial: "+44" },
  { code: "DE", name: "Allemagne", dial: "+49" },
  { code: "PT", name: "Portugal", dial: "+351" },
  { code: "BR", name: "Brésil", dial: "+55" },
  { code: "IN", name: "Inde", dial: "+91" },
  { code: "CN", name: "Chine", dial: "+86" },
  { code: "AE", name: "Émirats arabes unis", dial: "+971" },
  { code: "OTHER", name: "Autre", dial: "" },
];
