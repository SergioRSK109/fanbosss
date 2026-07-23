import { z } from "zod";

export const WHATSAPP_PRIX_MINIMUM = 20;

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
];

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
    bio: z.string().trim().max(500).nullable().optional(),
    lien_reseau_social: z.string().trim().url().nullable().optional(),
    classement_public: z.boolean().optional(),
    // Set after a successful upload via POST /api/profil/photo-upload-url
    // + PUT to R2 -- never accepted directly from arbitrary client input
    // without that round-trip, but the schema itself doesn't need to know
    // that; the upload route is what makes the key meaningful.
    photo_r2_key: z.string().nullable().optional(),
  })
  .strict();
