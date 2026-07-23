import { defineRouting } from "next-intl/routing";

// Français par défaut (produit lancé à Kinshasa) -- "as-needed" veut dire
// le français n'a pas de préfixe d'URL (/, /signup, /createur/x restent
// tels quels), seul l'anglais est préfixé (/en, /en/signup, /en/createur/x).
export const routing = defineRouting({
  locales: ["fr", "en"],
  defaultLocale: "fr",
  localePrefix: "as-needed",
});
