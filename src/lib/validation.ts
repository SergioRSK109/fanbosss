import { z } from "zod";

export const WHATSAPP_PRIX_MINIMUM = 500;

export const creerOffreSchema = z
  .object({
    type: z.enum(["video", "don", "whatsapp"]),
    prix: z.number().positive(),
    config: z.record(z.string(), z.unknown()).optional(),
  })
  .refine(
    (offre) => offre.type !== "whatsapp" || offre.prix >= WHATSAPP_PRIX_MINIMUM,
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
