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
