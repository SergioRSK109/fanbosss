import { z } from "zod";

export const WHATSAPP_PRIX_MINIMUM = 20;

// Mirrors the DB trigger's `interval '30 days'` (migration 0010) exactly
// -- shared by /api/profil (server-side enforcement) and the réglages
// page (telling the user when they'll be able to change it again) so the
// two never drift out of sync.
export const PSEUDO_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

// Null means "not locked": either the pseudo was never changed, or the
// cool-down has already elapsed.
export function pseudoLockedUntil(pseudoModifieAt: string | null): string | null {
  if (!pseudoModifieAt) {
    return null;
  }
  const unlockAt = new Date(pseudoModifieAt).getTime() + PSEUDO_COOLDOWN_MS;
  return unlockAt > Date.now() ? new Date(unlockAt).toISOString() : null;
}

export const OFFRE_TYPES = [
  "video",
  "don",
  "whatsapp",
  "shoutout",
  "contenu_debloque",
  "evenement_live",
] as const;

export type OffreType = (typeof OFFRE_TYPES)[number];

// `don` has no fixed price (brief point 4: a checkbox, not a price field --
// the fan picks their own amount at payment time); every other type
// requires one. Mirrors the DB constraints (offres_prix_required_unless_don,
// check_whatsapp_minimum_price) as defense in depth -- see brief 0.2.
export const creerOffreSchema = z
  .object({
    type: z.enum(OFFRE_TYPES),
    prix: z.number().positive().optional(),
    // Only meaningful for `video`: several video offers can coexist for the
    // same créateur, distinguished by libelle ("Anniversaire", "Danse",
    // ...). Every other type keeps a single row with libelle left null.
    libelle: z.string().trim().min(1).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    // Was missing entirely until this field was added, which meant the
    // désactiver/réactiver toggle in OffresManager silently never took
    // effect: the POST /api/offres route only ever wrote the columns zod
    // let through, so every offre stayed at the table's actif=true
    // default forever regardless of what the client sent.
    actif: z.boolean().optional(),
  })
  .refine((offre) => offre.type === "don" || offre.prix !== undefined, {
    message: "le prix est requis pour ce type d'offre",
    path: ["prix"],
  })
  .refine(
    (offre) =>
      offre.type !== "whatsapp" ||
      (offre.prix !== undefined && offre.prix >= WHATSAPP_PRIX_MINIMUM),
    {
      message: `le prix d'une offre whatsapp doit être >= ${WHATSAPP_PRIX_MINIMUM}$`,
      path: ["prix"],
    },
  );

export const modifierOffreSchema = z
  .object({
    prix: z.number().positive().optional(),
    actif: z.boolean().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

// Every top-level route segment the app currently uses -- mirrors the DB
// constraint users_pseudo_not_reserved (migration 0008) as defense in
// depth. The constraint is the real guarantee -- see brief 0.2's
// philosophy -- this just gives a clean 400 instead of a raw Postgres
// error. Update both places if new top-level routes are added.
export const PSEUDO_MOTS_RESERVES = [
  "dashboard",
  "signup",
  "login",
  "api",
  "auth",
  "createur",
  "mes-transactions",
  "paiement",
  "parametres",
  "explorer",
];

// Shared by the /@pseudo lookup and the /explorer search box: ILIKE
// treats `_` and `%` as wildcards, and `_` is itself a valid pseudo
// character, so an unescaped search term can match things it shouldn't
// (e.g. "test_1" matching "testX1"). Escape before handing a raw term to
// `.ilike()`/`.or()`.
export function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export const parametresProfilSchema = z
  .object({
    pseudo: z
      .string()
      .regex(/^[a-zA-Z0-9_]{3,20}$/, "3 à 20 caractères, lettres/chiffres/underscore uniquement")
      .refine((p) => !PSEUDO_MOTS_RESERVES.includes(p.toLowerCase()), {
        message: "ce pseudo est réservé",
      })
      .nullable()
      .optional(),
    // Distinct from pseudo (the technical, URL-safe handle): freeform
    // display name shown wherever the profile appears publicly. No format
    // constraint beyond a sane length -- it's never used for routing.
    nom_affichage: z.string().trim().max(60).nullable().optional(),
    bio: z.string().trim().max(500).nullable().optional(),
    lien_reseau_social: z.string().trim().url().nullable().optional(),
    classement_public: z.boolean().optional(),
    // Opt-out, independent of classement_public -- see migration 0009:
    // exploration visibility defaults ON once a créateur has an active
    // offre, the opposite default direction from the (opt-in) leaderboards.
    masque_exploration: z.boolean().optional(),
    // Set after a successful upload via POST /api/profil/photo-upload-url
    // + PUT to R2 -- never accepted directly from arbitrary client input
    // without that round-trip, but the schema itself doesn't need to know
    // that; the upload route is what makes the key meaningful.
    photo_r2_key: z.string().nullable().optional(),
  })
  .strict();
