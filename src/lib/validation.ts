import { z } from "zod";

export const WHATSAPP_PRIX_MINIMUM = 20;

// Mirrors publications.contenu's own CHECK constraint (char_length
// between 1 and 2000, migration 0029) exactly -- lives here rather than
// in src/lib/publications.ts specifically so PublicationComposer.tsx (a
// client component) can import it without pulling in that module's
// server-only Supabase data-fetching functions into the client bundle.
export const PUBLICATION_CONTENU_MAX_LENGTH = 2000;

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

// Mirrors the DB CHECK constraint `users_date_naissance_majorite`
// (migration 0016) exactly -- `date_naissance <= current_date - interval
// '18 years'` -- so the signup form's pre-submit check and the server's
// real enforcement never drift apart. Computed from UTC on purpose: the
// DB's `current_date` is evaluated in the database session's timezone
// (UTC on Supabase), while a naive client-side `new Date()` would use
// the visitor's local timezone -- using UTC here keeps the two aligned
// instead of the cutoff silently shifting by a day for a visitor near
// midnight. This can't fully eliminate every edge case (a visitor's
// system clock could simply be wrong), which is exactly why the DB
// constraint, not this helper, is the real guarantee.
export function minBirthDateForSignup(referenceDate: Date = new Date()): string {
  const year = referenceDate.getUTCFullYear() - 18;
  const month = String(referenceDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(referenceDate.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// dateNaissance is an ISO "YYYY-MM-DD" string (the native <input
// type="date"> format) -- plain lexicographic comparison against another
// ISO date string of the same shape sorts identically to a real date
// comparison, no Date parsing needed. An empty string sorts before every
// real date, which would otherwise make an unfilled field look "at least
// 18" -- explicitly rejected instead of relying on the lexicographic
// comparison alone.
export function isAtLeast18(dateNaissance: string, referenceDate: Date = new Date()): boolean {
  if (!dateNaissance) {
    return false;
  }
  return dateNaissance <= minBirthDateForSignup(referenceDate);
}

// "produit" (Phase 1 of the physical-product offer type) is included here
// -- and only here, deliberately -- so OffreType stays the one union the
// CinetPay webhook can type-check its own `offerType === "produit"`
// branching against, matching the DB's offres_type_check constraint
// (migration 0039). creerOffreSchema below is NOT extended with
// stock_total/image_r2_key validation for it -- offer *creation* for this
// type is Phase 2 (créateur UI on /offres), out of scope for this lot;
// see CLAUDE.md's own section on this lot.
export const OFFRE_TYPES = [
  "video",
  "don",
  "whatsapp",
  "shoutout",
  "contenu_debloque",
  "evenement_live",
  "campagne",
  "produit",
] as const;

export type OffreType = (typeof OFFRE_TYPES)[number];

// Both `don` and `campagne` have no fixed price (brief point 4 for don: a
// checkbox, not a price field; campagne is the same free-amount mechanic
// -- the fan picks their own contribution at payment time). Every other
// type requires one. Mirrors the DB constraints
// (offres_prix_required_unless_don, check_whatsapp_minimum_price) as
// defense in depth -- see brief 0.2.
export const creerOffreSchema = z
  .object({
    type: z.enum(OFFRE_TYPES),
    prix: z.number().positive().optional(),
    // Meaningful for `video` (several video offers can coexist for the
    // same créateur, distinguished by libelle -- "Anniversaire", "Danse")
    // and for `campagne` (the campaign's title -- a créateur can run
    // several campaigns over time, same NULLS NOT DISTINCT mechanism,
    // migration 0007/0017). Every other type keeps a single row with
    // libelle left null.
    libelle: z.string().trim().min(1).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    // Was missing entirely until this field was added, which meant the
    // désactiver/réactiver toggle in OffresManager silently never took
    // effect: the POST /api/offres route only ever wrote the columns zod
    // let through, so every offre stayed at the table's actif=true
    // default forever regardless of what the client sent.
    actif: z.boolean().optional(),
    // Phase 2 of the produit physique offer type: meaningful only for
    // `type: "produit"`, mirroring offres_stock_coherent (migration 0039)
    // as defense in depth -- see the produit-specific refine below.
    stock_total: z.number().int().positive().optional(),
  })
  .refine((offre) => offre.type === "don" || offre.type === "campagne" || offre.prix !== undefined, {
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
  )
  .refine((offre) => offre.type !== "campagne" || Boolean(offre.libelle), {
    message: "le titre de la campagne est requis",
    path: ["libelle"],
  })
  .refine(
    (offre) => {
      if (offre.type !== "campagne") return true;
      const objectif = Number(offre.config?.objectif);
      return Number.isFinite(objectif) && objectif > 0;
    },
    {
      message: "l'objectif de la campagne doit être un nombre positif",
      path: ["config", "objectif"],
    },
  )
  .refine(
    (offre) => {
      if (offre.type !== "campagne") return true;
      return typeof offre.config?.description === "string" && offre.config.description.trim().length > 0;
    },
    {
      message: "la description de la campagne est requise",
      path: ["config", "description"],
    },
  )
  .refine(
    (offre) => {
      if (offre.type !== "campagne") return true;
      const dateFin = offre.config?.date_fin;
      return dateFin === undefined || dateFin === null || /^\d{4}-\d{2}-\d{2}$/.test(String(dateFin));
    },
    {
      message: "date_fin doit être au format AAAA-MM-JJ",
      path: ["config", "date_fin"],
    },
  )
  // Phase 2 (Phase 1's own "What Phase 1 deliberately leaves broken"
  // note flagged this as the gap Phase 2 needed to close): a créateur can
  // list several distinct physical products, same NULLS NOT DISTINCT
  // multi-row mechanism video/campagne already use -- each one needs its
  // own title.
  .refine((offre) => offre.type !== "produit" || Boolean(offre.libelle), {
    message: "le nom du produit est requis",
    path: ["libelle"],
  })
  .refine((offre) => offre.type !== "produit" || offre.stock_total !== undefined, {
    message: "le stock du produit est requis",
    path: ["stock_total"],
  });

export const modifierOffreSchema = z
  .object({
    prix: z.number().positive().optional(),
    actif: z.boolean().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    // Same "upload-url route -> PATCH with the resulting key" pattern as
    // contenu_debloque's r2_key (stored in config -- see
    // content-upload-url's own doc comment), except image_r2_key is a
    // real top-level column (migration 0039), not a config key.
    image_r2_key: z.string().optional(),
    // Phase 2: lets a créateur restock an existing produit offer.
    stock_total: z.number().int().positive().optional(),
  })
  .strict();

// Mirrors the DB constraint users_pseudo_format (migration 0008)
// character-for-character -- exported so /api/pseudo/disponibilite and
// its client-side counterpart in ParametresForm check the exact same
// rule the database will actually enforce at save time, not a
// hand-copied approximation that could drift.
export const PSEUDO_FORMAT_REGEX = /^[a-zA-Z0-9_]{3,20}$/;

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
  "mot-de-passe-oublie",
  "reinitialiser-mot-de-passe",
  "admin",
  "classement",
  "finance",
  "offres",
  "home",
  "concours",
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
      .regex(PSEUDO_FORMAT_REGEX, "3 à 20 caractères, lettres/chiffres/underscore uniquement")
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
    // Simple links (no OAuth/account linking), shown on the public
    // profile -- distinct from the original lien_reseau_social collected
    // at signup, which stays editable only there, for manual identity
    // verification, and is deliberately absent from this schema.
    lien_tiktok: z.string().trim().url().nullable().optional(),
    lien_instagram: z.string().trim().url().nullable().optional(),
    lien_youtube: z.string().trim().url().nullable().optional(),
    lien_autre: z.string().trim().url().nullable().optional(),
    classement_public: z.boolean().optional(),
    // Opt-out, independent of classement_public -- see migration 0009:
    // exploration visibility defaults ON once a créateur has an active
    // offre, the opposite default direction from the (opt-in) leaderboards.
    masque_exploration: z.boolean().optional(),
    // Fan loyalty badge opt-in (migration 0022) -- same opt-in pattern as
    // classement_public: off by default, controls whether
    // badges_fidelite_publics exposes this user's badges (as a
    // supporter, and as a créateur's list of supporters) publicly.
    badge_fidelite_public: z.boolean().optional(),
    // Set after a successful upload via POST /api/profil/photo-upload-url
    // + PUT to R2 -- never accepted directly from arbitrary client input
    // without that round-trip, but the schema itself doesn't need to know
    // that; the upload route is what makes the key meaningful.
    photo_r2_key: z.string().nullable().optional(),
    // Cover/banner photo, same upload pipeline as photo_r2_key above
    // (the upload route is fully generic, keyed only by user id -- see
    // migration 0035) -- just a different profile field it gets written
    // to, and a different (wider, uncropped-by-the-user) processing step
    // client-side (src/lib/coverCrop.ts).
    photo_couverture_r2_key: z.string().nullable().optional(),
  })
  .strict();

// Créateur verification request (migration 0023) -- the DB CHECK
// constraint on demandes_verification.plateforme is the real guarantee;
// this is just a clean 400 instead of a raw Postgres error, same
// philosophy as every other schema in this file.
export const demandeVerificationSchema = z
  .object({
    plateforme: z.enum(["tiktok", "instagram", "youtube"]),
    lien_compte: z.string().trim().url(),
  })
  .strict();

// Lot 5a -- mirrors publications.contenu's own CHECK constraint
// (char_length between 1 and 2000) and publier_message()'s visibilite
// validation exactly, same "clean 400 instead of a raw Postgres error"
// philosophy as every other schema in this file. `type` is never
// accepted here at all -- publier_message() decides it server-side from
// the caller's own est_admin/createur_verifie, never from client input.
export const publierMessageSchema = z
  .object({
    // Nullable/optional since migration 0044 -- a publication carried
    // entirely by an image/video needs no text at all. Still enforces the
    // same 1-2000 char bound as publications_contenu_coherent whenever a
    // non-null value is actually given; the "at least one of
    // contenu/image/video" requirement is the .refine() below, mirroring
    // the DB constraint's own two-part shape.
    contenu: z.string().trim().min(1).max(PUBLICATION_CONTENU_MAX_LENGTH).nullable().optional(),
    image_r2_key: z.string().nullable().optional(),
    // Video support, additive alongside image_r2_key (migration 0037) --
    // never both on the same publication. publications_media_exclusif is
    // the real DB-level guarantee; the .refine() below is just the usual
    // "clean 400 instead of a raw Postgres error" this file already gives
    // every other DB CHECK constraint.
    video_r2_key: z.string().nullable().optional(),
    visibilite: z.enum(["public", "soutiens"]).optional(),
    // Lot 5c (migration 0031) -- "Autoriser le repost par d'autres
    // créateurs", only meaningful when visibilite is 'public' (a
    // soutiens-only post can never be reposted regardless of this value,
    // since toggler_repost_publication() already rejects any non-public
    // target). Forced to 'tous' server-side for an admin post either
    // way, same as visibilite itself -- see publier_message().
    autorise_repost: z.enum(["personne", "tous"]).optional(),
  })
  .strict()
  .refine((body) => !(body.image_r2_key && body.video_r2_key), {
    message: "une publication ne peut avoir à la fois une image et une vidéo",
    path: ["video_r2_key"],
  })
  .refine((body) => Boolean(body.contenu || body.image_r2_key || body.video_r2_key), {
    message: "une publication doit contenir du texte, une image ou une vidéo",
    path: ["contenu"],
  });
