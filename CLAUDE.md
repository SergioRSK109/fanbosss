@AGENTS.md

# FanBoss — project state and design decisions

This section is a working reference for picking this project back up in a
new session without re-deriving context. It reflects the schema and code
as of migration `0018` plus the follow-up fixes after it. When it and the
actual code disagree, the code is correct — update this file, don't trust
it blindly.

## What this is

A PWA letting **any user monetize their relationship with fans** — there
is no fan/créateur role distinction (removed in migration `0006`; a user
can both receive payments via their own offres and pay someone else via
theirs). Launching in Kinshasa, RDC. Founder is non-technical, solo, no
budget for an engineer — code must stay maintainable via Claude Code
alone, so the design leans on managed services (Supabase, Cloudflare R2,
CinetPay, Vercel) rather than anything self-hosted.

## Stack

- Next.js (App Router, PWA) on Vercel — **Next.js 16**, whose conventions
  differ from older training data (`middleware.ts` → `proxy.ts`, etc.) —
  see `node_modules/next/dist/docs/` before assuming behavior.
- Supabase: Postgres + Auth + Row Level Security. No Supabase Storage —
  file storage is Cloudflare R2.
- Cloudflare R2, **private bucket only**, accessed exclusively via
  presigned URLs (`src/lib/r2.ts`). There is no public bucket URL
  anywhere in this codebase, on purpose.
- CinetPay for payment (aggregates M-Pesa/Airtel Money/Orange Money).
- next-intl for i18n (fr default, en secondary).

Env vars: see `.env.example` for the full list (Supabase URL/anon/service
keys, CinetPay API key + site id + **secret key** used for HMAC, R2
account/access/secret/bucket, `CRON_SECRET`, `NEXT_PUBLIC_APP_URL`).

## Database schema (current, post-migration 0018)

Migrations are strictly incremental (`supabase/migrations/0001`...`0018`)
— never rewritten, never a `DROP`/recreate. Each one has been applied and
verified against both an empty DB and one seeded with pre-existing data
before being considered done (see "Testing" below for how).

### `users`
- `id uuid` PK
- ~~`role`~~ — **removed** in migration 0006 (was `createur`/`fan`/`both`,
  dropped entirely along with the RLS policy that filtered on it)
- `telephone text` — full international number, built client-side at
  signup from a country-code dropdown + local number
  (`src/lib/countries.ts`), concatenated before being sent
- `pays text default 'RDC'` — now set from the signup country selector,
  not hardcoded
- `province text` — added in `0012`, nullable/optional. Set from a
  signup dropdown (`src/lib/states.ts`, see "Province/ville" below),
  dependent on the selected country the same way the phone country
  selector already is. Stored as the province's display name (matching
  how `pays` stores the country's full name, not an ISO code) — no other
  table joins on it, so a normalized foreign key would add nothing.
  `users_province_max_length` caps it at 100 chars, same pattern as
  `bio`/`nom_affichage`.
- `ville text` — added in `0012`, nullable/optional. Plain free text (too
  many cities worldwide for a usable dropdown), capped at 100 chars via
  `users_ville_max_length`.
- `devise text default 'USD'`
- `parrain_id uuid references users(id)` — referral relationship
- `date_creation timestamptz`
- `pseudo text` — public handle, nullable (opt-in, set in `/parametres`
  not at signup). Constraints: `users_pseudo_format` (`^[a-zA-Z0-9_]{3,20}$`),
  `users_pseudo_not_reserved` (lowercased blacklist — see below),
  `users_pseudo_lower_unique_idx` — a **functional unique index on
  `lower(pseudo)`**, because a plain UNIQUE constraint on `pseudo` is
  case-sensitive and would let "Sergio"/"sergio" coexist. NULLs are
  allowed and non-conflicting (default btree unique-index behavior).
- `pseudo_modifie_at timestamptz` — added in `0010`. Null until the first
  real pseudo change. **Enforced by a trigger
  (`enforce_pseudo_cooldown`), not just app code**: a pseudo can only be
  changed again 30 days after this timestamp, and the trigger
  force-overwrites `NEW.pseudo_modifie_at` on every UPDATE (to `now()` on
  an actual pseudo change within the allowed window, or back to
  `OLD.pseudo_modifie_at` otherwise) regardless of what the caller sent
  for that column. This closes a real gap: `users_update_self` (RLS)
  lets an authenticated user PATCH their own row's *any* column directly
  via the Supabase REST API, bypassing `/api/profil` entirely — an
  app-only check could be defeated by backdating `pseudo_modifie_at` in
  the same request that changes `pseudo`. Verified in `checklist_2_3.sql`
  that this exact bypass attempt is rejected. The trigger raises with a
  custom SQLSTATE (`FB001`) specifically so callers (including the SQL
  tests) can distinguish "blocked by cooldown" from any other exception.
  `src/lib/validation.ts#pseudoLockedUntil(pseudoModifieAt)` computes the
  same 30-day window in JS (`PSEUDO_COOLDOWN_MS`) — used by both
  `/api/profil` (a clean 403 with the unlock date, before ever hitting
  the trigger) and `/parametres` (telling the user when they can change
  it again). The DB trigger is what actually guarantees it; the JS check
  is only there for a good error message.
- `bio text` — max 500 chars (`users_bio_max_length`). **No longer
  collected at signup** (removed from `SignupForm.tsx` along with
  `lien_reseau_social`, see below) — only ever set/edited from
  `/parametres` post-signup now.
- `photo_r2_key text` — nullable; only ever settable through the
  authenticated upload flow (`/api/profil/photo-upload-url` → PUT to R2 →
  PATCH `/api/profil`), **never collected at signup** (no authenticated
  session yet at that point to key an R2 object against)
- `lien_reseau_social text` — single link, `zod .url()` validated at the
  API layer. **Since migration `0011`, this is manual-identity-
  verification-only** — no longer editable from `/parametres`, no longer
  rendered on the public profile. **Also no longer collected at signup**
  (`SignupForm.tsx` dropped both this and `bio`) — as of now there is no
  UI path left that writes this column at all; it's permanently null for
  every account created after this change. Flagged back to the user when
  this was removed rather than silently leaving a dead column — if manual
  identity verification is still needed, it now has to happen some other
  way (e.g. asked for directly, outside the app) until a new UI path is
  added. What the profile shows instead is the four columns below.
- `lien_tiktok text`, `lien_instagram text`, `lien_youtube text`,
  `lien_autre text` — added in `0011`. Simple links (no OAuth, no
  official account linking), each optional, editable in `/parametres`,
  rendered as icon chips on the public profile
  (`CreateurProfileView`/`SOCIAL_LINK_ICONS`) when set. No DB format
  constraint, same as `lien_reseau_social` before it — validated
  app-side only (`zod .url()` in `parametresProfilSchema`).
- `classement_public boolean not null default false` — opt-in for the
  leaderboards
- `dernier_vu_demandes_at timestamptz` — null means "never viewed"; used
  for the "N nouvelles demandes" badge on the dashboard
- `nom_affichage text` — added in `0009`. Freeform public display name,
  distinct from `pseudo` (the URL-safe technical handle): no format or
  uniqueness constraint, just `users_nom_affichage_max_length` (≤60
  chars). Wherever a créateur profile is shown publicly, resolve it via
  `resolveDisplayName(nomAffichage, pseudo)` in `src/lib/profil.ts`
  (nom_affichage → pseudo → `null`, with callers falling back to a
  generic translated label) — **don't re-implement this fallback chain
  inline**, every public-facing surface (profile header, `/explorer`
  cards) shares it. **Since `0016`, also collected at signup**:
  `SignupForm.tsx` asks for separate "Nom"/"Post-nom" fields and
  concatenates them into this same column client-side before calling
  `signUp()` — there's no separate nom/postnom column, this is still the
  one existing `nom_affichage` field, just populated earlier than before.
  Still freely editable afterward from `/parametres` exactly as always.
- `date_naissance date` — added in `0016`. Nullable (existing accounts
  predate this column and can't be retroactively assigned a birth date),
  but collected as a required field at signup going forward.
  `users_date_naissance_majorite` enforces a real 18+ minimum at the DB
  level: `check (date_naissance is null or date_naissance <= current_date
  - interval '18 years')` — see "Signup: nom/post-nom + 18+ age gate"
  below for the full empirical verification (both of the syntax itself
  and of the client-side layers backing it up) and why NULL is
  unaffected by this CHECK.
- `masque_exploration boolean not null default false` — added in `0009`.
  Opt-*out* of `/explorer`, deliberately the opposite default direction
  from `classement_public`'s opt-*in*: a créateur becomes explorable the
  moment they have one active offre, unless they flip this. See "Product
  judgment calls" below for why, and the first-offre transparency notice
  that makes sure this default is never silent.
- `est_admin boolean not null default false` — added in `0015`. Gates
  `/admin` (see "Admin dashboard" below). **The real guarantee that a
  normal user can never self-promote is a DB trigger, not application
  code** — `users_update_self`'s RLS policy lets an authenticated user
  PATCH their own row's *any* column via a raw REST call, the exact same
  class of gap already closed for `pseudo_modifie_at` in `0010`.
  `enforce_est_admin_change` (BEFORE UPDATE) silently reverts any change
  to this column unless `auth.uid()` already belongs to an admin —
  verified with an explicit attack test in `checklist_2_3.sql`, same
  pattern as the pseudo-cooldown bypass test.

Reserved pseudo words (kept in sync in **two** places — the DB CHECK
constraint (most recently updated in `0028`) and `PSEUDO_MOTS_RESERVES`
in `src/lib/validation.ts` — update both if new top-level routes are
added): `dashboard, signup, login, api, auth, createur, mes-transactions,
paiement, parametres, explorer, mot-de-passe-oublie,
reinitialiser-mot-de-passe, admin, classement, finance, offres`.

### `offres`
- `id uuid` PK, `createur_id uuid references users(id)`
- `type text` — `check (type in
  ('video','don','whatsapp','shoutout','contenu_debloque','evenement_live','campagne'))`
  — `campagne` (fundraising campaigns) added in migration `0017`
- `prix numeric` — **nullable**, but `offres_prix_required_unless_don`
  enforces non-null for every type except `don`/`campagne` (the fan
  picks the amount at payment time for both, so neither has a fixed
  price — see "Fundraising campaigns" below)
- `check_whatsapp_minimum_price`: `type != 'whatsapp' or prix >= 20`
  (was 500 in the original brief, lowered to 20 later — this constraint
  is on the billed `prix` column itself, never on `config`, precisely so
  no application code path can accidentally bypass it)
- `actif boolean default true` — **was silently unwritable via the API
  until a real bug fix**: `creerOffreSchema` (POST `/api/offres`, which
  `OffresManager`'s désactiver/réactiver toggle calls) didn't declare
  `actif` at all, so zod's default non-strict parsing quietly dropped it
  from every request body and the upsert never included it in its SET
  list — every offre stayed at the table default (`true`) forever
  regardless of what the client sent. Fixed by adding `actif:
  z.boolean().optional()` to the schema and threading it into
  `upsertPayload` the same way `config` already was. Covered by a
  regression test in `validation.test.ts` asserting `actif` survives
  parsing in both directions — the schema accepting the request was never
  the problem, silently losing the field afterward was.
- `config jsonb default '{}'` — holds type-specific data:
  `contenu_debloque` → `{r2_key}` (uploaded once, at the offer level, not
  per-transaction — every paying fan unlocks the *same* file);
  `evenement_live` → `{lien_live}` (external stream link, e.g.
  YouTube/Zoom, revealed to a fan only after their transaction is
  `livree` — never copied into the transaction, so an updated link is
  reflected immediately for everyone who already paid); `campagne` →
  `{description, objectif, date_fin}` — see "Fundraising campaigns"
  below. Unlike `evenement_live`'s config, none of campagne's keys are
  secret, so they're safe to expose in full through a public view (see
  `campagnes_publiques`).
- `libelle text` — **meaningful for `video` and `campagne`**: a créateur
  can list several video offers distinguished by label ("Anniversaire" at
  10$, "Danse" at 15$), or run several fundraising campaigns over time,
  each with its own title stored here. Every other type leaves this
  null.
- `unique_offre_type_par_createur`: `unique NULLS NOT DISTINCT
  (createur_id, type, libelle)` — this is the mechanism that makes
  "one offre per type" hold for every type except `video`/`campagne`.
  **Do not simplify this to a plain UNIQUE constraint** — plain UNIQUE
  treats every NULL as distinct, so two whatsapp/don/etc. rows (both with
  `libelle = null`) would silently stop conflicting and a créateur could
  end up with duplicates of a type that's supposed to be exclusive.
  Verified this exact failure mode empirically before deciding on NULLS
  NOT DISTINCT (see git history on migration `0007`). `campagne` needed
  no change to this constraint at all — it just became a second type that
  supplies a non-null libelle, reusing the exact mechanism video already
  established.

### `transactions`
- `id uuid` PK, `fan_id`, `createur_id`, `offre_id` (all FKs)
- `montant numeric check (montant > 0)`
- `statut text check (statut in ('en_attente','validee','livree','remboursee','refusee'))`
  — `refusee` exists in the enum but the actual flow never sets it;
  refusals go straight to `remboursee` (see lifecycle below)
- `livrable jsonb default '{}'` — for `video`/`shoutout`: `{r2_key}` set
  by `deliver_video()`
- `reference_cinetpay text`
- `deadline_acceptation timestamptz` — auto-set by trigger
  `set_deadline_acceptation()` at INSERT time, based on the offer's type
  (see lifecycle below); this is what makes the "creator never responds"
  case have a hard deadline instead of leaving a fan stuck forever
- `deadline_livraison timestamptz` — auto-set by trigger
  `set_deadline_livraison()` when a `video`/`shoutout` transaction
  transitions into `validee`
- `repondu_at timestamptz` — **when the créateur actually responded**
  (set by `accept_transaction`/`refuse_transaction`), as opposed to
  `deadline_acceptation` which is only the deadline. Added for the
  réactivité leaderboard. Deliberately left null by the deadline cron
  (`process_transaction_deadlines`) so a no-response auto-refund is never
  counted as "responsive".
- `created_at timestamptz`
- `reference_remboursement_cinetpay text`, `remboursement_tentative_a
  timestamptz`, `montant_rembourse numeric`,
  `necessite_remboursement_manuel boolean not null default false` —
  added in `0014`, see "Automatic CinetPay refunds" below. Live on
  `transactions` rather than `paiements` because a `paiements` row isn't
  guaranteed to exist yet at refund time (the acceptation-deadline refund
  path fires while still `en_attente`).

### `paiements`
One row per transaction (unique FK), created by trigger
`create_paiement_on_validation()` the moment a transaction reaches
`validee`, frozen at that point (never recomputed later):
`montant_brut`, `commission_plateforme` (17% of brut, since migration
`0018` — was 20% before that), `frais_agregateur` (3% of brut), `tva`
(16% of commission), `montant_net_createur`, `statut_paiement`
(`initie`→`reussi` on delivery, →`rembourse` on refund).
`frais_agregateur`/`tva` are still computed and stored on every row —
real bookkeeping, not dead columns — but since `0018` neither is
deducted from `montant_net_createur` anymore: `montant_net_createur =
montant_brut - commission_plateforme` only, the platform absorbing both
instead of passing them through to the créateur. See "Commission rate"
below for how this gap (requested previously, never actually wired in)
was found and fixed.

### `parrainages`
`parrain_id`, `filleul_id`, `transaction_id`, `montant_bonus` (10% of the
transaction's commission), unique per `(transaction_id, filleul_id)`.
Generated by trigger `handle_transaction_livraison()` when a transaction
reaches `livree`, for whichever of `fan_id`/`createur_id` was referred
(`parrain_id is not null`) **and** is still within their 30-day window
from their own `date_creation`. Créateur→créateur affiliation is this
exact same mechanism now that there's no fan/créateur split — no separate
code path.

### `parametres_plateforme`
Feature-flag key/value store, seeded in `0004`:
`abonnements_actifs`, `avis_actifs`, `multi_devise_actif`,
`multi_agregateur_actif` — genuinely unbuilt placeholders, default
`false`. Plus `contenu_debloque_actif`, `evenement_live_actif` — added in
`0006`, defaulting to **`true`** (deliberate call: unlike the four above,
these two ship fully built and are already part of the standard offer
creation flow, so hiding them by default didn't make sense; flip to
`false` in this table any time to hold them back, no redeploy needed).
Plus `remboursement_cinetpay_actif` (default **`false`**) and
`remboursement_pourcentage` (default `100`) — added in `0014`, see
"Automatic CinetPay refunds" below. Unlike the flags above, these two are
actually read by the application (`src/lib/refunds.ts`) — the others are
still unconsulted placeholders as of this writing.

### `reports`
`reporter_id`, `reported_user_id`, `type` (`signalement`/`blocage`),
`raison`, `statut`.

### Public views (never expose the raw tables for cross-user reads)
- `profils_publics`: `id, pays, devise, date_creation, pseudo, bio,
  photo_r2_key, lien_reseau_social, nom_affichage, lien_tiktok,
  lien_instagram, lien_youtube, lien_autre` — deliberately excludes
  `telephone` and (transitively, since it's a separate table) any
  monetary data. `lien_reseau_social` is still exposed here for now
  (unchanged) even though nothing public renders it anymore — see the
  `lien_reseau_social` entry above.
- `offres_publiques`: `id, createur_id, type, prix, actif, created_at,
  libelle` — deliberately excludes `config` (which can hold
  `evenement_live`'s pre-payment secret link). Still filtered to
  `actif = true`, including for `campagne` rows — a closed campaign
  should stop looking purchasable here the same way any other inactive
  offer does; its public history lives in `campagnes_publiques` instead
  (below), not here.
- `campagnes_publiques` and `campagnes_montant_collecte` (added `0017`)
  — see "Fundraising campaigns" below.
- `profils_explorables` (added `0009`): same public columns as
  `profils_publics`, filtered to `masque_exploration = false` and `exists
  (select 1 from offres where createur_id = id and actif = true)`.
  Backs `/explorer`. Deliberately **never** selects `masque_exploration`
  itself — callers don't need to know a créateur opted out, they just
  don't see them; verified in `checklist_2_3.sql` that the column never
  appears in this view's `information_schema.columns`. Joins straight to
  the `users` base table (for `masque_exploration`) the same way
  `classement_*` views join it for `classement_public` — same
  view-owner-bypasses-RLS mechanism, nothing new.
- `classement_volume`, `classement_reactivite`, `classement_progression`
  — **rank only** (`createur_id, rang`), never the underlying count or
  average. All three: 30-day rolling window, scoped to
  `classement_public = true`. Réactivité only considers
  `video`/`shoutout`/`whatsapp` transactions with a non-null `repondu_at`
  (the only types with a real acceptation step). Progression only ranks
  accounts created in the last 30 days.

All of these views are created by the migration-running role, which in a
real Supabase project has `BYPASSRLS` (verified empirically with a
throwaway non-bypassrls role querying through such a view before relying
on this anywhere) — so they safely expose a public subset regardless of
RLS on the underlying tables, without granting any direct table access.

## RLS model

- `users`: **self-only** (`id = auth.uid()`) for direct table access. No
  broad "public profile" policy exists anymore — the previous one
  (`role in ('createur','both')`, removed in `0006`) matched nearly every
  account and, since RLS filters rows not columns, exposed `telephone` to
  any authenticated caller who queried the table directly. Public reads
  go through `profils_publics` instead.
- `offres`: `offres_select_own` (owner, all columns) is the only
  SELECT policy on the raw table; public reads go through
  `offres_publiques`. Insert/update/delete are owner-only.
- `transactions`: no direct UPDATE policy for anyone — **every state
  transition goes through `SECURITY DEFINER` RPCs**
  (`accept_transaction`, `refuse_transaction`, `deliver_video`) so a
  créateur can never write an arbitrary `statut` via a raw table write.
  SELECT is `fan_id = auth.uid()` or `createur_id = auth.uid()`. INSERT
  is blocked for authenticated users too — rows are only ever created by
  the webhook, via the service-role client.
- `paiements`: SELECT only for the créateur of the linked transaction.
- `parrainages`: SELECT only where `parrain_id = auth.uid()`.
- `parametres_plateforme`: SELECT for everyone, no INSERT/UPDATE policy
  (service-role only).
- `reports`: INSERT/SELECT scoped to `reporter_id = auth.uid()`.

Routes that legitimately need another user's non-public column (an
authenticated fan reading the créateur's phone number after paying for
WhatsApp access, or reading `offres.config` for content/live-link
delivery) use the **service-role client**, but only ever *after*
re-verifying `fan_id = auth.uid() AND statut = 'livree'` themselves in
that same route — see `whatsapp-link`, `content-url`, `live-link` routes.
This is the established pattern for "authenticated route needs to bypass
RLS for a specific, already-authorized read" in this codebase; don't add
a new broad table policy when this pattern already covers the need.

## Transaction lifecycle (state machine)

Offer types split into two groups:

**Has an acceptation step** (`video`, `shoutout`, `whatsapp`): webhook
inserts the transaction as `en_attente` with `deadline_acceptation`
auto-set (+24h for video/shoutout, +48h for whatsapp). The créateur must
call `accept_transaction` or `refuse_transaction` (both `SECURITY
DEFINER`, ownership + deadline re-checked server-side) before the
deadline or the cron auto-refunds it. Accepting sets `repondu_at` and
`statut = validee` (which triggers `paiements` creation and, for
`video`/`shoutout`, a `deadline_livraison` +48h). For `whatsapp`,
acceptance immediately cascades to `livree` too (accepting IS the
delivery — the number is revealed). For `video`/`shoutout`, delivery is a
separate step: `upload-url` → PUT to R2 → `deliver_video` RPC (name kept
from when only `video` existed; now also validates `shoutout` — see
migration `0006`) sets `livree` before `deadline_livraison`.

**No acceptation step, immediate validation** (`don`, `contenu_debloque`,
`evenement_live`): the webhook inserts and then updates straight from
`en_attente` → `validee` → `livree` in the same request (two sequential
UPDATEs, not a single insert-as-livree, so the `create_paiement_on_validation`
trigger — which only fires on the transition *into* `validee` — still
runs). `TYPES_A_VALIDATION_IMMEDIATE` in the webhook route is the single
source of truth for this set; extend it there if a new type needs the
same treatment.

The hourly cron (`process_transaction_deadlines()`, called via
`/api/cron/check-deadlines`, protected by `CRON_SECRET` bearer token)
handles both deadline cases **separately**: (a) `en_attente` past
`deadline_acceptation` → `remboursee`; (b) `validee` past
`deadline_livraison` → `remboursee`. A previous attempt at this project
only tracked the livraison deadline, leaving a fan stuck forever if the
créateur just never responded to the acceptation request at all — this
split is why both exist.

**Vercel Hobby plan limits cron to once/day**, too slow for these
deadlines. There's no `vercel.json` `crons` block; instead
`/api/cron/check-deadlines` is meant to be hit hourly by a free external
scheduler (cron-job.org/EasyCron) — see README for the exact setup. If
the project moves to Vercel Pro, `vercel.json`'s crons block can come
back and the external scheduler can be retired. Since migration `0017`,
this same route also calls `close_expired_campagnes()` right after
`process_transaction_deadlines()` — see "Fundraising campaigns" below;
both RPC calls must succeed for the route to return 200, so a failure in
either one still surfaces as a real error to the external scheduler
rather than silently skipping half the sweep. Since migration `0025`, a
third RPC call, `process_confirmation_deadlines()`, auto-confirms any
video/shoutout delivery a fan never responded to within 72h — see "Fan
confirmation state" below; same "every RPC call must succeed for a 200"
discipline applies to it too.

## Fan confirmation state — video/shoutout only (Lot 2a, migration `0025`)

**Scope, stated explicitly so a later session doesn't quietly extend
it**: this mechanism applies to `video`/`shoutout` **only** — the two
types where a créateur delivers a personalized, judgeable piece of
content. `don`, `evenement_live`, `whatsapp`, `contenu_debloque`, and
`campagne` are untouched: they still reach and leave `livree` exactly as
before, and `confirmation_fan` stays `'non_applicable'` for them forever
— there is no code path anywhere that sets it to anything else for a
non-video/shoutout transaction. Verified directly in `checklist_2_3.sql`
by delivering a whatsapp transaction (via `accept_transaction`, whose
acceptance cascades straight to `livree`) and a don transaction (via the
webhook's own two-step `en_attente → validee → livree`) and confirming
`confirmation_fan` never moves off `non_applicable` for either.

**Schema**: `transactions` gained three columns —
`confirmation_fan text check (... in ('non_applicable', 'en_attente',
'confirme', 'conteste')) not null default 'non_applicable'`,
`deadline_confirmation timestamptz`, `confirme_at timestamptz`. Living on
`transactions` rather than a new table, same reasoning as the CinetPay
refund columns (migration `0014`): one row already exists per
transaction, no need for a join.

**`deliver_video()`** (migration `0002`, security-hardened in `0020`) is
the *only* writer of `'en_attente'` — the moment it sets a video/shoutout
transaction to `livree`, it also sets `confirmation_fan = 'en_attente'`
and `deadline_confirmation = now() + interval '72 hours'`, in the same
`UPDATE`. Nothing else about the function changed — same auth.uid()
check, same ownership/type/deadline guards, same `authenticated`-only
EXECUTE grant (a `create or replace` with an identical signature leaves
existing grants untouched, so `0025` doesn't re-state them).

**Two new fan-facing RPCs**, same `SECURITY DEFINER` discipline as every
transaction-state function since the `0020` fix (explicit
`auth.uid() is null` rejection, `is distinct from` for the ownership
check, `revoke all ... from public` + `grant execute ... to
authenticated`):
- `confirmer_livraison_fan(p_transaction_id)` — `fan_id = auth.uid()`,
  `statut = 'livree'`, `confirmation_fan = 'en_attente'` → sets
  `confirmation_fan = 'confirme'` and stamps `confirme_at`.
- `contester_livraison_fan(p_transaction_id)` — same eligibility guard →
  sets `confirmation_fan = 'conteste'`. **Deliberately does not touch
  `statut` or `necessite_remboursement_manuel`** — no refund is
  attempted, on purpose. That flag specifically means "a refund already
  happened and needs the real CinetPay follow-through" (migration
  `0014`); a dispute hasn't concluded a refund is even warranted, so
  setting it would misrepresent what actually happened. What "l'argent
  reste gelé" (the money stays frozen) actually means here, stated
  plainly rather than implied: this app has no "release funds to
  créateur" step at all yet — money-movement automation only exists for
  fan-side refunds (still a documented stub, see "Automatic CinetPay
  refunds"). `handle_transaction_livraison()` already marks
  `paiements.statut_paiement = 'reussi'` the instant `deliver_video()`
  sets `statut = 'livree'`, in the same `UPDATE`, exactly as it did
  before this migration — a dispute doesn't (and, without touching that
  trigger, can't) reverse that bookkeeping flag. What disputing actually
  does is raise a visible flag for a human to review
  (`/admin`'s "Litiges en attente", below) and prevent auto-confirmation
  — nothing more. Same "flag and wait for a human" discipline as a
  créateur-verification conflict (migration `0023`): no automated
  resolution exists, and none should be added here without a real
  product decision about what "resolving" a dispute even means (partial
  refund? full refund? dismiss and pay the créateur? — all out of scope
  for this lot).

The eligibility guard (`statut = 'livree' and confirmation_fan =
'en_attente'`) is what makes the type-scope self-enforcing at the
function level, not just by convention: calling either RPC on a
whatsapp/don/etc. transaction (stuck at `non_applicable` forever) or on
one already confirmed/disputed always raises `'transaction is not
awaiting fan confirmation'`, never silently no-ops. Verified directly,
including the specific case of a fan attempting to confirm a delivered
*whatsapp* transaction.

**Auto-confirmation sweep**: `process_confirmation_deadlines()`, a new
function rather than a branch inside `process_transaction_deadlines()`.
Deliberately kept separate — `process_transaction_deadlines()`'s only
caller (`/api/cron/check-deadlines`) loops over every row it returns and
calls `processAutomaticRefund()` for each one, since every case that
function has ever handled ends in `statut = 'remboursee'`. An
auto-confirmed transaction never changes `statut` at all (already
`livree`, stays `livree`) — folding it into that same return channel
would need either a new discriminator column or reliance on
`processAutomaticRefund()`'s own re-read-and-no-op behavior for a
non-`'remboursee'` row, both more confusing than a second, clearly-named
function. Same precedent as `close_expired_campagnes()` (migration
`0017`), which rides this same hourly external-cron infrastructure as
its own second RPC call rather than being merged in either — `0025`
adds a *third* call, same "every RPC call must succeed for the route to
return 200" discipline. `service_role`-only EXECUTE, same pattern as
`process_transaction_deadlines()`/`close_expired_campagnes()` (migration
`0021`'s audit) — a global sweep with no per-caller scoping, so no
authenticated or anonymous caller has any legitimate reason to invoke it
directly. Verified with a real backdated `deadline_confirmation`: the
expired transaction is auto-confirmed (`confirme_at` stamped) while a
sibling transaction whose window is still open is left untouched by the
same sweep call.

**Fan UI** (`TransactionActions.tsx`, `describeTransactionStatutFan` in
`src/lib/transactions.ts`): a delivered video/shoutout with
`confirmation_fan = 'en_attente'` shows two buttons — "Satisfait" /
"Signaler un problème" (`Dashboard.confirmation.*`) — alongside the
existing "Voir ma vidéo"/"Voir mon shoutout" reveal button, not instead
of it (the fan still needs to actually view what was delivered).
`describeTransactionStatutFan` gained two new optional params
(`confirmationFan`, `deadlineConfirmation`) and two new branches for the
`livree` case: a concrete-deadline sentence while `en_attente` (same
"real date, not a vague label" pattern as the existing
`en_attente`/`validee` branches), and a distinct "Signalé — en cours de
révision" sentence once `conteste`. Both params are optional and only
ever meaningful for video/shoutout — passing them for any other type is
harmless, since neither branch's condition can ever be true for a
transaction stuck at `confirmation_fan = 'non_applicable'`. Clicking
either button calls `/api/transactions/[id]/confirm` or `.../contest`
(thin RPC wrappers, same shape as `accept`/`refuse`) and
`router.refresh()`s on success — the component holds no local copy of
`confirmation_fan`, so a successful action makes the buttons disappear
via the parent's fresh server data, not local state.

**Admin UI** (`/admin`, `LitigesManager.tsx`): a new "Litiges en attente"
section, visually mirroring "Remboursements manuels en attente" (card
list, montant/créateur/fan/date, oldest first) but **deliberately
read-only** — no "Marquer comme traité" action, unlike the manual-refunds
list. This lot's scope never defined what resolving a dispute actually
means (see above), and the schema has no flag to clear even if a button
were added; this section exists purely so a human can *see* the worklist
today, same "structure only, no automated/manual-resolution UI yet"
posture as créateur-verification conflicts. Ordered by `created_at`
(transaction creation) — the only timestamp this schema actually has for
these rows, since disputing doesn't stamp its own timestamp the way
confirming does via `confirme_at`.

Tested end-to-end in `checklist_2_3.sql`, not just described: delivery
opens the window with a real ~72h deadline; manual confirmation stamps
`confirme_at` without touching `statut`; a second confirmation attempt on
an already-confirmed transaction is rejected (eligibility guard, not a
silent no-op); disputing freezes the transaction (`statut` stays
`livree`, `necessite_remboursement_manuel` and
`reference_remboursement_cinetpay` both stay untouched — no refund
attempted); the auto-confirmation sweep confirms only a transaction past
its deadline, leaving a sibling with a still-open window untouched;
whatsapp and don transactions reaching `livree` never have
`confirmation_fan` touched; and the full `0020`/`0021` security pattern
(`anon` has no `EXECUTE` on any of the three new functions,
`authenticated` with a `NULL auth.uid()` is rejected by each function's
own check, a different authenticated user can't act on someone else's
transaction, none of the rejected attempts leave any trace, and the
legitimate callers still hold `EXECUTE`).

## Litige resolution — admin decision on a disputed delivery (Lot 2a-bis, migration `0026`)

Follow-up to Lot 2a (migration `0025`, above), which deliberately left
"Litiges en attente" **read-only** — resolving a dispute wasn't defined
yet. This lot defines it: an admin can now rule `faveur_createur` or
`faveur_fan` on any `conteste` transaction, from the same section that
used to be purely informational.

**Schema**: `transactions` gained four columns, purely for traceability
of the decision — `litige_resolution text check (... in
('faveur_createur', 'faveur_fan'))`, `litige_resolu_par uuid references
users(id)`, `litige_resolu_at timestamptz`, `litige_note_admin text`
(optional free-text, e.g. "vidéo hors-sujet, remboursé"). None of these
four is read by any other function or trigger in this codebase — they
exist solely so a human can audit who decided what, when, and why.

**`resoudre_litige(p_transaction_id, p_decision, p_note default null)`**
is a `SECURITY DEFINER` RPC, same exact style as
`mark_remboursement_manuel_traite()`/`set_admin_status()` (migration
`0015`): re-verifies `not exists (select 1 from users where id =
auth.uid() and est_admin = true)` internally rather than trusting the
caller was already checked client-side, `revoke all ... from public` +
`grant execute ... to authenticated` only (never `anon`, never
`service_role` — an admin action always requires a real session, exactly
like every other admin RPC in this project). This equality-based check
is NULL-safe by construction (unlike the `!=` bug fixed in migration
`0020`) — `auth.uid() IS NULL` never matches any real `id`, so `not
exists(...)` is unconditionally `true` and the function raises `'not
authorized'` for an unauthenticated caller with no extra check needed,
the same reasoning migration `0021`'s audit already established for
`mark_remboursement_manuel_traite`/`set_admin_status`. Eligibility is
re-checked too — `confirmation_fan = 'conteste' and litige_resolu_at is
null` — so a litige can only ever be resolved once; a second attempt
raises `'transaction not found or already resolved'` rather than
silently re-applying (or worse, double-refunding).

**`faveur_fan` needs no new logic at all beyond setting `statut =
'remboursee'`.** `handle_transaction_remboursement()` (migration `0014`)
already fires on any transition into `remboursee` and sets
`paiements.statut_paiement = 'rembourse'` and
`necessite_remboursement_manuel = true` — a litige resolved against the
créateur rides this exact same trigger a plain refuse/deadline-refund
would, rather than duplicating what it does. This is deliberate reuse,
not an oversight: the whole point of routing every refund path through
one trigger is that a new caller of "make this `remboursee`" never needs
to remember what bookkeeping that implies.

**`faveur_createur` deliberately reuses the existing `confirmation_fan =
'confirme'` state, not a new one (e.g. `'confirme_par_admin'`).** This is
the one design decision in this migration worth spelling out plainly,
since it shapes what a later "Lot 2b" (a wallet/withdrawal balance,
referenced but not yet built as of this writing) can assume: **a
transaction is withdrawable the instant `confirmation_fan = 'confirme'`,
full stop, regardless of *how* it got there.** A dispute resolved in the
créateur's favor sets `confirmation_fan = 'confirme'` and stamps
`confirme_at = now()` — exactly the two writes `confirmer_livraison_fan`
itself makes — so Lot 2b's eventual "what can this créateur withdraw"
query never needs a special case for "confirmed normally" vs. "confirmed
via a resolved litige." `litige_resolution`/`litige_resolu_par`/
`litige_resolu_at` are what preserve *that* distinction, for anyone who
needs to know why a specific transaction reached `confirme` — but
`confirmation_fan` alone, deliberately, does not. `statut` is left
untouched in this branch (stays `livree`, same as a normal confirmation).

**Admin UI** (`/admin`'s "Litiges en attente" section, `LitigesManager.tsx`)
went from the deliberately read-only card list Lot 2a shipped to a fully
interactive one: each row now has an optional free-text note input plus
two buttons, "Trancher en faveur du créateur" / "Trancher en faveur du
fan" (`Admin.litiges.trancherCreateur`/`trancherFan`/`notePlaceholder`),
same per-row `pendingId`/`errorById` client-side pattern as
`RemboursementsManuelsManager` — a successful resolution calls
`router.refresh()` rather than mutating local state, so the row
disappears via the page's own fresh query, not a client-side splice.
`/admin/page.tsx`'s litige query gained `.is("litige_resolu_at", null)`
— without it, a resolved litige would stay listed forever, since
resolving one (in either direction) never changes `confirmation_fan`
away from `'conteste'` for the `faveur_fan` branch specifically (only
`faveur_createur` moves it to `'confirme')`; the `litige_resolu_at`
filter is what actually removes a resolved row from this list, not a
`confirmation_fan` check. New route: `/api/admin/resoudre-litige`, same
thin-wrapper shape as `/api/admin/mark-remboursement-traite` — validates
`transactionId`/`decision` are present, trims a blank note to `null`,
surfaces any RPC rejection as a 403.

Tested end-to-end in `checklist_2_3.sql`, not just described: both
outcomes on real disputed video/shoutout deliveries (`faveur_fan` sets
`statut = remboursee` and is confirmed to ride the *existing*
`handle_transaction_remboursement()` trigger — `paiements.statut_paiement
= 'rembourse'` and `necessite_remboursement_manuel = true`, without this
migration adding any code that sets either directly; `faveur_createur`
sets `confirmation_fan = 'confirme'` and stamps `confirme_at` without
touching `statut`); a second resolution attempt on an already-resolved
litige is rejected; a genuinely non-admin authenticated caller (the
créateur on the very dispute being resolved, chosen specifically to also
prove an interested party can't rule in their own favor) is rejected;
`authenticated` with a `NULL auth.uid()` is rejected the same
`'not authorized'` way (the NULL-safe equality check, not a separate
guard); `anon` has no `EXECUTE` at all (real Postgres permission check);
none of the rejected attempts left any trace; and `authenticated` still
holds `EXECUTE` positively confirmed.

## Wallet ledger + withdrawal requests (Lot 2b, migration `0027`)

A créateur's earnings so far live entirely inside `paiements`/
`transactions`, split across every row — there was no single place
answering "how much can I actually withdraw right now." This lot adds
that computation (never stored, always live, same discipline as
`campagnes_montant_collecte`) plus a minimum-$25 withdrawal-request flow
on top of it. **No automated payout exists anywhere in this codebase
still** — same honesty as "Automatic CinetPay refunds" above: marking a
request `traite` records that a human already sent the money manually
outside the app, it never triggers a real transfer itself.

**The three buckets, computed by one shared query, never duplicated**
(same principle as `calculerRepartitionPaiement()`/
`computeCampagneStatus()` elsewhere in this file):

```
en_attente_livraison = Σ montant_net_createur
  où paiements.statut_paiement = 'initie'

en_litige = Σ montant_net_createur
  où paiements.statut_paiement = 'reussi' ET confirmation_fan = 'conteste'
  ET litige_resolu_at IS NULL

net_a_retirer = Σ montant_net_createur
  où paiements.statut_paiement = 'reussi'
  ET confirmation_fan IN ('confirme', 'non_applicable')
  MOINS Σ demandes_retrait.montant où statut != 'refuse'
```

**`solde_wallet_createur(p_createur_id uuid)`** is the single SQL
definition of all three — a `SECURITY DEFINER` function (needs to read
across `paiements`/`transactions`/`demandes_retrait`, the same reason
`mes_progres_classement()` is a function rather than a view+RLS policy),
called from exactly two places: `demander_retrait()` below (to validate a
request server-side) and `/finance`'s own display. It takes an explicit
`p_createur_id` parameter — unlike `mes_progres_classement()`'s
no-parameter, purely-self-referential shape — but still enforces
`p_createur_id is distinct from auth.uid()` internally before doing
anything else, so there is no way to ask for anyone else's balance
through it; the parameter exists only so `demander_retrait()` can pass
its own `auth.uid()` through to the one shared query rather than
re-deriving the same numbers a second way. `revoke all ... from public` +
`grant execute ... to authenticated` only, same pattern as every RPC
since migration `0020`.

**`net_a_retirer` is what makes the Lot 2a-bis design decision pay off,
exactly as flagged when it was made**: `faveur_createur` resolutions
reuse `confirmation_fan = 'confirme'` rather than a new state (see
"Litige resolution" above), so a litige resolved in the créateur's favor
already satisfies this formula's `confirmation_fan in ('confirme',
'non_applicable')` clause with zero special-casing — verified directly
in `checklist_2_3.sql` by resolving a real disputed transaction and
confirming it moves from `en_litige` straight into `net_a_retirer` with
no code path here even aware litige resolution exists.

**`demander_retrait(p_montant numeric)`** — same `SECURITY DEFINER`
discipline as every state-changing RPC since migration `0020`: requires
`auth.uid()`, rejects `p_montant < 25` server-side (the client's own
$25 minimum, `RETRAIT_MONTANT_MINIMUM` in `src/lib/wallet.ts`, is a UX
convenience only — never trusted), and — the part that actually matters
— **recomputes `net_a_retirer` itself, in SQL, via
`solde_wallet_createur(auth.uid())`**, rejecting if `p_montant` exceeds
that real, server-side number. There is no client-supplied balance
anywhere in this path; a "falsified amount" attack is simply calling this
RPC directly with a number larger than the real balance, which is exactly
what `checklist_2_3.sql` does and confirms is rejected. Inserts the row
at `'en_attente'` on success.

**`traiter_retrait(p_id, p_decision, p_note default null)`** — same exact
shape as `resoudre_litige()`/`mark_remboursement_manuel_traite()`:
re-verifies `est_admin` internally (NULL-safe by construction, same
reasoning as every other admin RPC), requires the target request to still
be `'en_attente'` (a second decision on an already-handled request is
rejected, never silently re-applied), and `revoke all ... from public` +
`grant execute ... to authenticated` only. `'traite'` means a real manual
transfer already happened outside the app — this RPC only records the
decision (who, when, an optional note), it never moves money.

**`demandes_retrait` has no INSERT/UPDATE policy for authenticated users
at all** — same "state machine only via a vetted RPC" shape as
`transactions`/`demandes_verification`. Its one RLS policy,
`demandes_retrait_select_own` (`createur_id = auth.uid()`), is what a
créateur's own `/finance` history query relies on to only ever see their
own requests — **not exercised in `checklist_2_3.sql` via a direct
SELECT**, flagged explicitly rather than silently skipped: this whole
checklist file runs as the Postgres superuser, which bypasses RLS
unconditionally regardless of `app.current_user_id`, and this project's
local `stub_auth.sql` harness (unlike a real Supabase project) never
grants `authenticated`/`anon` any table-level privileges either, so
switching role can't exercise it here — no other table's RLS policy is
verified this way in this file. What *is* verified, and is the guarantee
that actually prevents harm regardless of the SELECT side: `traiter_retrait()`
rejects any non-admin caller outright, including the requesting créateur
themselves attempting to self-approve their own withdrawal.

**`/finance`** (`src/app/[locale]/finance/page.tsx`) — new, standalone
route, **not yet linked from the top nav** (`src/app/[locale]/layout.tsx`)
per instruction, deferred to a later "Lot 4"; reachable today via a new
"💰 Paiements" link on `/dashboard`'s own header, next to "⚙️ Réglages"
(the displayed label — "Paiements"/"Payments" — was renamed from
"Finance"/"Finance" after initial ship; the route stays `/finance` and
the `Finance` i18n namespace/component names are unchanged, since neither
is user-visible).
Renders the three buckets above (via `solde_wallet_createur`), a
withdrawal request form (`RetraitRequestForm.tsx`, disabled with an
explicit "Solde minimum pour demander un retrait : 25$." message whenever
`net_a_retirer < RETRAIT_MONTANT_MINIMUM`), and two history lists:
"Paiements reçus" (new — every transaction this créateur received,
classified into the same buckets via `classifyPaiementRecu()` in
`src/lib/wallet.ts`, a pure per-row mirror of the SQL formula above kept
deliberately in sync with it) and "Paiements envoyés à d'autres
créateurs" (moved here verbatim from `/dashboard`, same query/
`TransactionActions`/`describeTransactionStatutFan` code, not
duplicated — the `Dashboard` translation namespace still backs these
generic per-transaction strings, since renaming it would be a much wider
change than this lot needs; `Finance` is a separate namespace only for
this page's own headings/labels).

**`classifyPaiementRecu()`\'s "autre" fallback is deliberately not the
same as "disponible", even for a successful payment**: a delivered
video/shoutout still inside its 72h fan-confirmation window
(`confirmation_fan = 'en_attente'`, migration `0025`) has
`statut_paiement = 'reussi'` but does **not** satisfy
`net_a_retirer`'s `confirmation_fan in ('confirme', 'non_applicable')`
clause — labeling it "disponible" here would disagree with the aggregate
shown above it on the same page. It falls back to the raw transaction
statut badge instead (reusing `Dashboard.statutShort`), same as a
transaction with no `paiements` row at all yet.

**Admin UI** (`/admin`'s new "Demandes de retrait en attente" section,
`RetraitsManager.tsx`) mirrors `LitigesManager.tsx`'s interactive
pattern exactly (per-row `pendingId`/`errorById`/`noteById`, optional
note field, `router.refresh()` on success) — two buttons, "Marquer
traité" / "Refuser", **not a single toggle**, since refusing a request
must never touch the wallet balance the same way marking it handled does
(see the formula's `statut != 'refuse'` clause). `/admin/page.tsx`'s new
query filters `.eq("statut", "en_attente")`, oldest first, same
operational-queue principle as the manual-refunds/litiges worklists.

Reserved pseudo: `'finance'` added to both `users_pseudo_not_reserved`
(migration `0027`) and `PSEUDO_MOTS_RESERVES` — every new top-level route
needs this.

Tested end-to-end in `checklist_2_3.sql` with a real fixture créateur
carrying four transactions in four different states (one per bucket, plus
a whatsapp transaction proving `non_applicable` counts toward
`net_a_retirer` exactly like `confirme` does): all three buckets compute
to the exact expected numbers under the real 15% HT + TVA commission
formula; resolving one of the disputed transactions `faveur_createur`
moves it from `en_litige` into `net_a_retirer` with **no code in this
migration aware that a litige was ever involved**; `demander_retrait()`
rejects both a sub-$25 amount and an amount exceeding the real balance
(including a direct RPC call with a deliberately falsified amount, the
only kind of "client-controlled amount" that exists in this design);
neither rejected attempt leaves a row behind; a pending request is
subtracted from `net_a_retirer` immediately, a `traite` one keeps being
subtracted (the money is actually gone now), and a `refuse`d one stops
being subtracted; `traiter_retrait()` rejects a non-admin caller
(including the requesting créateur attempting to self-approve) and a
second decision on an already-handled request; and the full
`0020`/`0021` security pattern holds for all three new functions (`anon`
has no `EXECUTE`, `authenticated` with a `NULL auth.uid()` is rejected by
each function's own check, `solde_wallet_createur` rejects a caller
asking for someone else's balance, and the legitimate caller still holds
`EXECUTE`).

## Tab-bar navigation reorg (Lot 3, migration `0028`)

Everything from Lots 1–2b (commission, fan confirmation, litige
resolution, the wallet) was functionally complete but scattered across
separate pages with no coherent structure — `/dashboard` in particular
mixed four unrelated concerns (public profile link, ranking badges,
pending requests, offer configuration). This lot is a pure reorganization
into **4 fixed bottom tabs** (mobile-app style, confirmed with the
founder), displayed left to right as **Offres** (`/offres`, new),
**Paiements** (`/finance`), **Performance** (`/dashboard`), **Réglages**
(`/parametres`) — no business logic in any moved component changed.

**Route group, URLs unchanged.** `src/app/[locale]/(app)/` groups the 4
tab destinations under one shared layout without adding a URL segment —
`(parens)` folders are Next.js's mechanism for exactly this. `/dashboard`,
`/finance`, and `/parametres` keep their existing URLs (already relied on
elsewhere as post-login/signup/password-reset redirect targets — see
`login/page.tsx`, `signup/page.tsx`, `auth/callback/route.ts`,
`mot-de-passe-oublie/page.tsx`), confirmed unaffected because every
existing redirect references these by URL string, never by file path.
`/admin`, `/createur/[id]`, `/[handle]`, `/explorer`, `/classement`,
`/login`, `/signup`, and the password-reset routes stay siblings outside
`(app)` — `/admin` deliberately keeps its own separate access logic (see
"Admin dashboard" above), not this créateur-facing nav. Verified the
group creates no routing ambiguity with the dynamic `/[handle]` catch:
Next.js always prefers a literal static match (`/offres`, `/dashboard`,
...) over a sibling dynamic segment regardless of route grouping — the
same precedence the `[handle]` page's own comment already documented
before this lot existed — and `offres` was added to the reserved-pseudo
list (below) as defense in depth on top of that, exactly like every
other top-level route.

**New route `/offres`**, migration `0028`: adds `'offres'` to
`users_pseudo_not_reserved` (DB) and `PSEUDO_MOTS_RESERVES`
(`src/lib/validation.ts`) — same two-places discipline as `'finance'` in
`0027`. Verified in `checklist_2_3.sql` (a fresh user attempting to set
`pseudo = 'Offres'` is rejected by the CHECK constraint directly, same
pattern as the `'classement'` reserved-pseudo test).

**What moved where** (verbatim components/queries, no logic changes):
- `src/app/[locale]/(app)/dashboard/page.tsx` — now "Performance" only:
  the 3 `RankBadge`s, `ClassementProgresCard`, `BadgesFideliteCard`. Still
  named `DashboardPage`, still reads from the `Dashboard` i18n namespace
  (`Dashboard.heading` was retitled to "Performance"/"Performance") —
  renaming the file or the namespace would be a much wider change than
  this lot needs, same "route/internal name vs. displayed label" call
  already made for Finance/"Paiements" in Lot 2b.
- `src/app/[locale]/(app)/offres/page.tsx` — **new**: `DemandesEnAttente`
  + `OffresManager`, plus the "N nouvelles demandes" notification-badge
  logic (`dernier_vu_demandes_at` read/update) and the campagne
  montant-collecté query, all moved unchanged from the old
  `/dashboard`. Still reads `Dashboard.demandesHeading`/
  `Dashboard.nouvellesDemandes`/`Dashboard.offresHeading` for these
  sections' own headings rather than a new namespace, same
  not-renaming-what-isn't-user-visible reasoning. Its own page heading
  ("Offres"/"Offers") lives in a new `OffresPage` namespace.
- `src/app/[locale]/(app)/finance/page.tsx`, `.../parametres/page.tsx` —
  moved as directories via `git mv`, zero content changes beyond
  removing the now-redundant "back to dashboard" link each used to show
  in its own header (the tab bar is the nav now). `Finance.backToDashboard`
  and `Parametres.backToDashboard` were removed from both message files
  as a result — confirmed dead via grep before deleting, not just left
  as unused strings. `/parametres` already had `LogoutButton` in its
  header (added when logout itself was built, well before this lot) —
  the brief's "+ déconnexion" requirement for the Réglages tab was
  already satisfied; this lot only repositioned it once the adjacent
  "back to dashboard" link was gone.

**The public profile link (`fanboss.app/@pseudo` + `CopyProfileLinkButton`)
lives in the shared layout, not any one tab.** It's identity, not one of
the 4 categories — per the brief's own recommendation, confirmed as the
best fit rather than forcing it into a tab. `src/app/[locale]/(app)/layout.tsx`
fetches the caller's own `pseudo` (a third `auth.getUser()` call per
request, same pattern the root layout already established for its own
Explorer-link check) and renders the card above `{children}` on all 4
pages, so it can never drift between them. When there's no user (a
direct hit on one of these URLs while logged out), the layout simply
skips the card and lets the page itself perform its existing
`redirect()` to `/login` — this layout adds no new auth gate, each page
keeps the same guard it always had.

**`AppTabBar.tsx`** — a `"use client"` component using `usePathname`
from `@/i18n/navigation` (locale-stripped, so it matches plain `/dashboard`
etc. regardless of `/en` prefix) to highlight the active tab via
`aria-current="page"` plus brand-colored text, styled with this app's
existing tokens only (`border-border`, `bg-surface/95 backdrop-blur`,
`text-brand-600 dark:text-brand-300`) — no new design system introduced,
per the `frontend-design` skill check performed before building it
(this app already has a deliberate, non-default violet/coral identity;
the tab bar just needed to not contradict it). `fixed inset-x-0 bottom-0
z-40` — one level below the `z-50` full-screen overlays
(`ZoomablePhoto`/`PhotoCropper`) so a photo zoom/crop still draws on top
of it. The 4 tabs' emoji, in their displayed left-to-right order
(🎁/💰/📊/⚙️ -- Offres/Paiements/Performance/Réglages), follow the same
no-icon-library convention as `RankBadge`/the old dashboard header
links. The route stays `/finance` (unchanged since Lot 2b) — only the
tab's displayed label is "Paiements"/"Payments". This left-to-right
order (Offres first, Performance third) was a deliberate later
adjustment from the order this lot originally shipped with
(Performance/Paiements/Offres/Réglages) — the `TABS` array in
`AppTabBar.tsx` is the single source of truth for it; nothing else in
this codebase orders the 4 tabs independently.

**Bottom padding**: the shared layout wraps `{children}` in a
`pb-24` div so page content never scrolls behind the fixed tab bar —
verified visually by scrolling a long page (`/offres`, with every offer
type's form visible) all the way down and confirming the last card
clears the bar with room to spare, at a real mobile viewport (390×844).
The old dashboard/finance pages' own `pb-16` (added ahead of this lot,
apparently anticipating exactly this) was removed from their `<main>`
now that the layout provides the space generically for all 4 pages,
including `/parametres` which never had it.

Verified end-to-end with the same throwaway mock-Supabase/Playwright
technique used throughout this file (a ~200-line mock of the Auth
`/token`/`/user` endpoints plus a generic PostgREST-shaped REST/RPC
mock, never committed): logged in once, then visited all 4 tabs in both
`fr` (default) and `/en/`-prefixed sessions — correct heading/label per
page and locale, the active tab visually distinct via `aria-current`,
the profile-link card present and identical across all 4 pages, zero
console errors, and dark mode (`colorScheme: "dark"`) rendering correctly
via the app's existing CSS-variable overrides with no tab-bar-specific
dark-mode code needed.

## Publications — créateur posts + FanBoss announcements, with visibility gating (Lot 5a, migration `0029`)

A créateur (once verified) or an admin can post short text updates
("Quoi de neuf ?", up to 2000 chars, one optional image), visible either
to everyone (`public`) or only to that créateur's own supporters
(`soutiens`) — shown on the créateur's own profile (new "Publications"
tab) and, for verified créateurs' posts plus every FanBoss announcement,
on a new global `/home` feed. **Lot 5b (moderation of the `masque`
flag — an admin's ability to actually hide a reported/inappropriate
publication) is a deliberate follow-up, not built here**: `masque` exists
in the schema and is already honored by every read path (a `masque=true`
row never appears, not even as a teaser), but nothing in this lot ever
sets it to `true` — there is no moderation UI yet, same "structure only,
no UI yet" posture this project has already used for other two-part
features (créateur verification's palier 2, litige resolution before
`0026`).

**Schema**: `publications` (`id, auteur_id, type, contenu, image_r2_key,
visibilite, masque, created_at`), given exactly as specified —
`type check (type in ('createur', 'annonce_fanboss'))`,
`contenu check (char_length(contenu) between 1 and 2000)`,
`visibilite check (visibilite in ('public', 'soutiens')) default
'public'`, `masque boolean not null default false`. Two indexes
(`(auteur_id, created_at desc)`, `(created_at desc)`) — the first backs
the profile page's own-posts query, the second the global feed's
newest-first ordering. RLS: `publications_select_own` (`auteur_id =
auth.uid()`), same self-only default as every other user-owned table —
no INSERT/UPDATE policy for authenticated at all, every write goes
through `publier_message()` below, same "state machine only via a
vetted RPC" shape as `transactions`/`demandes_verification`.

**`soutient_createur(p_fan_id, p_createur_id)`** is exactly the plain
(non-`security definer`) function specified — `exists (select 1 from
transactions where fan_id = p_fan_id and createur_id = p_createur_id and
statut = 'livree')`. Deliberately invoker-rights: a direct call by an
authenticated caller stays scoped by `transactions`' own RLS (`fan_id =
auth.uid() or createur_id = auth.uid()`), which is exactly right for a
fan checking their own support relationship and conservatively `false`
(never a leak) for asking about someone else's.

**The server-side access layer — the actual point of this lot — needed
one non-obvious fix, found by testing rather than assumed.** The
straightforward-looking design (a public view calling `soutient_createur()`
directly in its `SELECT` list to decide teaser-vs-full per row) was
**built, then empirically disproven** against a throwaway database before
being trusted, per this project's standing "reproduce a non-obvious
Postgres mechanism before relying on it" discipline (the same discipline
that already caught the pseudo-cooldown/admin-escalation/`0020` bugs):
a plain (non-`security definer`) function called from inside a view does
**not** inherit the view owner's RLS-bypass the way a table referenced
directly in the view's own `FROM`-list does — Postgres evaluates that
function's internal query under the *actual querying role's* privileges,
not the view owner's. A minimal reproduction (a throwaway
`t_secret`/`restricted_role`/`migrator_role` setup, mirroring this
project's real `authenticated`/migration-role split) confirmed it
directly: calling a plain invoker-rights function from a view's `SELECT`
list came back `false` for every row regardless of the real answer, while
the exact same check written as a `security definer` function (or
inlined directly in the view) came back correct. **The fix**:
`peut_voir_publication_complete(p_auteur_id, p_visibilite)` is a small
`security definer` wrapper (`p_visibilite = 'public' or auth.uid() =
p_auteur_id or (auth.uid() is not null and soutient_createur(auth.uid(),
p_auteur_id))`) — a `security definer` function's execution context (and
that of any invoker-rights function it calls internally, confirmed the
same empirical way) runs as the function owner, the same bypass mechanism
`classement_volume`/`profils_explorables` etc. already rely on for the
tables they reference directly. This is also the one deliberate exception
in this codebase to "never grant a `security definer` function to
`anon`" (migrations `0020`/`0021`): `anon` needs a real, non-erroring
answer here too (an anonymous profile visitor), which is always "show the
teaser" — safe specifically because this function takes no fan-id
parameter at all (always `auth.uid()` internally), so there's no way to
use it to ask about anyone else's relationship. A second pitfall caught
the same way: `auth.uid() = p_auteur_id` is SQL `NULL` (not `false`) for
an anonymous caller, and `false OR NULL` is itself `NULL`
(three-valued logic) — without an explicit `coalesce(..., false)`
wrapping the whole expression, `contenu_complet` would surface as SQL
`NULL` instead of a clean boolean for an anonymous viewer, even though
the `CASE WHEN` for `contenu`/`image_r2_key` happens to still treat a
`NULL` condition as "not true" either way. Verified directly, not
assumed: an anonymous viewer's `contenu_complet` is `false`, never blank/
`NULL`.

**`publications_visibles`** (view, granted to `authenticated, anon`) is
the actual per-row teaser/full decision: `contenu`/`image_r2_key` are
each a `case when peut_voir_publication_complete(...) then <col> else
null end`, and `contenu_complet` is that same function's raw boolean —
an **explicit** flag, never something the app has to infer from
nullability (`contenu` can never be legitimately null on a real row, the
table's own CHECK requires 1-2000 chars, so nulling it out is
unambiguous evidence of a teaser either way, but an explicit flag is
clearer to consume and removes any need to guess). Excludes `masque =
true` rows entirely, not even as a teaser — Lot 5b's flag, already
effective before that lot builds any UI to set it. **`publications_accueil`**
layers on top (`join users ... where u.createur_verifie = true or
v.type = 'annonce_fanboss'`) for the global feed — scoped to *currently*
verified créateurs (not frozen at post time, same "always compute live"
principle as `campagnes_montant_collecte`/the verification conflict
check) plus every FanBoss announcement regardless of the posting admin's
own `createur_verifie`. **Deliberate asymmetry**: a créateur's own
`/[handle]`/`/createur/[id]` profile page reads `publications_visibles`
directly (filtered by `auteur_id`, no verification filter at all) — so
an unverified créateur's past posts stay visible on their own profile
even after they've dropped out of the global feed. Not an oversight;
"requête filtrée auteur_id" was the brief's own instruction for the
profile tab, and the two surfaces answer genuinely different questions
("what has this créateur posted" vs. "what should the front page
promote").

**`publier_message(p_contenu, p_image_r2_key default null, p_visibilite
default 'public')`** is a `security definer` RPC, same discipline as
every write RPC since migration `0020` (`auth.uid() is null` rejected,
`revoke all ... from public` + `grant execute ... to authenticated`
only). Server-decided, never trusted from the client: `type` is admin →
`annonce_fanboss` (`visibilite` force-overwritten to `'public'` — a
FanBoss announcement soutiens-only makes no sense), else `createur` —
re-verified here that the caller is actually an admin **or**
`createur_verifie` at all (`raise exception 'not authorized: verified
créateurs or admins only'` otherwise), the same "never trust the client
alone" reasoning as the whatsapp price floor/age gate, even though the
composer UI is already gated the same way. If a caller is somehow both
(an admin who's also independently `createur_verifie`), admin wins —
posting as an admin is a platform announcement, not a personal update; a
product judgment call, flagged as such since the brief didn't
disambiguate. Rate-limited to 10 per rolling 24h window
(`created_at > now() - interval '24 hours'`), applied uniformly with no
admin exception — a spam flood is a spam flood regardless of who's
posting. **A real bug caught before it shipped**: this function's
`returns table (id, type, visibilite, created_at)` OUT parameters shadow
plain column references the exact same way `creer_demande_verification()`
already documented (migration `0023`) — an unqualified `where id =
v_user_id`/`created_at > ...` inside the function body raised "column
reference is ambiguous" against the OUT parameter instead of resolving
to the table column, caught empirically (a throwaway DB run, not
assumed) and fixed by table-qualifying (`users.id`,
`publications.created_at`, `publications.auteur_id`).

**`/api/publications`** (POST) is a thin RPC wrapper, same shape as every
other one in this project — `publierMessageSchema` (`src/lib/validation.ts`)
mirrors `publications.contenu`'s own CHECK constraint
(`PUBLICATION_CONTENU_MAX_LENGTH = 2000`, deliberately kept in
`validation.ts` rather than `src/lib/publications.ts` specifically so
`PublicationComposer.tsx`, a client component, can import the constant
without pulling that module's server-only Supabase data-fetching
functions into the client bundle — caught by a real Turbopack build
error, not spotted by inspection, the first time the constant lived
next to `getPublicationsForAuteur`/`getPublicationsAccueil` instead).
**`/api/publications/upload-url`** (POST) mirrors
`content-upload-url`'s pattern (offres) — re-checks admin-or-`createur_verifie`
before minting a presigned R2 PUT URL (`publications/{userId}/{uuid}`),
redundant with, not a substitute for, `publier_message()`'s own re-check
— and additionally rejects any non-`image/*` content type, since this
route's only purpose is publication images (`content-upload-url` accepts
arbitrary content types for its own, different, `contenu_debloque`
purpose).

**`src/lib/publications.ts`** — `getPublicationsForAuteur(auteurId)` (the
profile tab) and `getPublicationsAccueil(page)` (the paginated `/home`
feed, `PUBLICATIONS_ACCUEIL_PAGE_SIZE = 10`, same `.range()`/`{count:
"exact"}` pattern as `/explorer`) both read their respective view, then
hydrate each row's `auteur` (`profils_publics`, resolved once per unique
author id, batched — a busy poster's photo isn't re-signed once per one
of their several posts) and `imageUrl` (a presigned R2 GET, 1h expiry —
deliberately shorter than profile photos' 24h: a `soutiens`-only image is
genuinely sensitive, unlike a profile photo, even though a fresh URL is
minted on every render regardless).

**UI**: `PublicationTeaser.tsx` is a real, visually distinct "locked"
component (lock emoji, "Réservé aux soutiens de {auteur}", a link to the
créateur's own profile — which is already sufficient since Offres is
that profile's default tab, no query-param deep-link needed) — not
CSS-blurred real text, because the server never sends the real
`contenu`/`image_r2_key` for a teaser row in the first place; there is
nothing for a client-side blur to hide. `PublicationCard.tsx` renders
either the teaser or the full card (author, optional "FanBoss"/"Réservé
aux soutiens" pill, contenu, optional image) based on `contenuComplet`
alone, never on whether `contenu` happens to be null. `ProfileTabs.tsx`
(new client component) is a plain client-side tab switch (no navigation,
no query param) between "Offres" (default — campagnes + the offres
list, exactly what used to be `CreateurProfileView`'s only content below
the header) and "Publications" (the new list) — both tabs' content is
already rendered server-side by `CreateurProfileView` and just handed in
as pre-built React nodes; supporters/rank badges stay above the tabs
(identity, not tied to either tab), `badgesFidelite` stays below (same
reasoning). `PublicationComposer.tsx` (client) is shown only when the
page decides to (admin or `createur_verifie`) — textarea + optional image
+ Public/Mes soutiens `<select>`, uploads the image first (if any) then
calls `/api/publications`, `router.refresh()`s on success so the new
post appears via the page's own fresh server data, not local state.

**`/home`** (`src/app/[locale]/(app)/home/page.tsx`) is the new 5th
`AppTabBar` destination — **Accueil**, added first (`🏠`), left of
Offres/Paiements/Performance/Réglages. Unlike the other 4, this page
deliberately does **not** redirect a logged-out visitor to `/login` —
the whole point of the visibility layer is that an anonymous visitor can
browse public posts and see a locked teaser for `soutiens`-only ones, so
gating the page itself behind a session would defeat that. The shared
`(app)` layout's own auth check is unaffected (it already only
conditionally shows the profile-link card, never redirects), so this
needed no layout change — only this one page's own absence of a
redirect. `/home` added to `PSEUDO_MOTS_RESERVES` (`src/lib/validation.ts`)
and `users_pseudo_not_reserved` (DB, migration `0029`) — same two-places
discipline as every previous route addition.

Tested end-to-end in `checklist_2_3.sql` with a real fixture (créateur A
— verified, fan B — a real supporter via a `livree` transaction, fan C —
a stranger, admin D — deliberately **not** itself `createur_verifie`, to
prove an admin's own verification status is irrelevant to posting as
`annonce_fanboss`): `soutient_createur()` correct for both the supporter
and the stranger; an admin's post is forced to
`type=annonce_fanboss`/`visibilite=public` regardless of what was
requested; **the teaser is never accompanied by the real content in the
DB response itself** — a real supporter sees both a créateur's `public`
and `soutiens` post in full, while a stranger *and* an anonymous viewer
both get `contenu`/`image_r2_key = NULL` and a clean `contenu_complet =
false` (not SQL `NULL`) for the `soutiens` one; the créateur always sees
their own posts in full; `publications_accueil` includes the verified
créateur's posts and the FanBoss announcement together; the 10/24h rate
limit rejects an 11th post within the window and leaves no row behind;
a non-verified, non-admin caller is rejected outright; and the full
`0020`/`0021` security pattern holds (`anon` has no `EXECUTE` on
`publier_message()`, `authenticated` with a `NULL auth.uid()` is
rejected, and — the one deliberate exception — `anon` **does** correctly
have `EXECUTE` on `peut_voir_publication_complete()`). Verified visually
end-to-end too (same throwaway mock-Supabase/Playwright technique used
throughout this file): the composer renders only for a
`createur_verifie` user, a locked teaser card renders distinctly from a
real post on both `/home` and the profile page's Publications tab, the
5-tab `AppTabBar` shows Accueil first and highlights it correctly, and
all of the above holds in both `fr` and `/en/`-prefixed sessions and in
dark mode.

## Moderation of publications (Lot 5b, migration `0030`)

A fan or créateur can flag a publication they've actually read (never a
locked teaser), and an admin can hide it — or reject the flag and leave
it visible. **Lot 5c (likes) is the next step after this one, not
started here.**

**Schema — extends the existing `reports` table, not a new one, per
explicit instruction**: `reports` gained a single nullable
`publication_id uuid references publications(id) on delete set null`
column. Nullable means every existing (WhatsApp-adjacent, `ReportButton.tsx`)
report row is completely untouched — same table, same three-statut
workflow (`en_attente`/`traite`/`rejete`), same admin worklist mechanism,
just one more column that's only ever set by the new publication-report
path below. `reports` still has no `traite_par`/`traite_at`/`note_admin`
columns at all (deliberately not added here either, matching "juste une
colonne en plus") — see the admin UI note below for what that rules out.

**`signaler_publication(p_publication_id, p_raison)`** is a `security
definer` RPC (needs to read an arbitrary publication's `auteur_id`/
`visibilite` regardless of who owns it — `publications_select_own`'s RLS
is self-only). "On ne signale pas un teaser qu'on n'a pas lu": it
re-uses `peut_voir_publication_complete()` exactly as Lot 5a already
built it — no duplicated eligibility logic — and rejects outright if the
caller can't see the target publication's full content. On success it
inserts into `reports` with `type = 'signalement'`, `reported_user_id`
= the publication's `auteur_id`, `publication_id` set, `statut =
'en_attente'`. Same `auth.uid() is null → raise` + `revoke all from
public` / `grant execute to authenticated` discipline as every write RPC
since migration `0020`.

**`masquer_publication(p_publication_id, p_masque)`** is a standalone
moderation primitive — admin-only (re-verifies `est_admin` internally,
same `not exists(...)` NULL-safe shape as `mark_remboursement_manuel_traite`/
`resoudre_litige`/`traiter_retrait`), and **only** toggles the `masque`
flag Lot 5a already added to the schema. `publications_visibles`/
`publications_accueil` already exclude `masque = true` rows entirely —
this is the exact "already effective before Lot 5b builds any UI to set
it" gap Lot 5a flagged, now closed. Nothing on the display side needed
to change at all; verified directly (below) that a masked publication
disappears from both views immediately, even for its own auteur.

**`traiter_signalement_publication(p_report_id, p_decision)`** is the
admin action behind the "Publications signalées" worklist below —
resolves one *report*, not the publication in isolation. This is a
second RPC, not folded into `masquer_publication`, precisely because
`reports` has no admin-decision columns of its own (see the schema note
above) — this function is the only admin-only write path for a report's
own `statut`, for *either* outcome. `p_decision = 'masquer'` updates
`publications.masque = true` directly (not a nested call to
`masquer_publication()` — the admin check would just be re-verified for
nothing, since this function is already inside its own verified-admin
security-definer context) and sets the report `statut = 'traite'`;
`p_decision = 'rejeter'` only ever touches the report, the publication is
left completely untouched. Same re-entrancy guard as every other admin
RPC (`statut != 'en_attente' → already handled`, raised rather than
silently re-applied).

**`/api/publications/[id]/signaler`** (POST) and
**`/api/admin/traiter-signalement-publication`** (POST) are both thin
RPC wrappers, same shape as every other one in this project — neither
re-implements any of the real eligibility/authorization logic, which
lives entirely in the two RPCs above.

**UI**: `ReportPublicationButton.tsx` (new, small client component,
mirroring `ReportButton.tsx`'s own simplicity — no raison text collected
there either) renders **only** from `PublicationCard.tsx` (the
full-content view) — never from `PublicationTeaser.tsx`, consistent with
`signaler_publication()`'s own server-side restriction: a locked post
has no "Signaler" affordance to click in the first place, so there's
nothing for the UI to even attempt. `PublicationsSignaleesManager.tsx`
(admin) mirrors `LitigesManager.tsx`/`RetraitsManager.tsx`'s interactive
pattern (per-row `pendingId`/`errorById`, `router.refresh()` on success)
but **deliberately has no note field**, unlike those two — there is no
column to persist one to (see the schema note above). Each row shows the
auteur, the reporter, the flagged publication's own contenu (read via
the admin's service-role query, regardless of the publication's own
`visibilite`/`masque` state — an admin must be able to read what was
reported to judge it), and the optional `raison`, with two buttons:
"Masquer la publication" / "Rejeter le signalement". `/admin/page.tsx`'s
new query filters `reports` to `.not("publication_id", "is", null)` and
`.eq("statut", "en_attente")` — a resolved report (either outcome)
naturally drops out of this list since `statut` moves off `en_attente`
either way, same "the query's own filter is what removes a handled row"
principle as every other admin worklist in this project.

**A real, non-obvious test-harness gotcha, caught before it wasted more
time than it should have**: an early draft of the SQL checklist test for
this lot tried to `SELECT ... FROM publications`/`FROM reports` directly
while impersonating `authenticated`/`anon` via `SET ROLE`, and hit a
flat "permission denied for table publications" — not an RLS-filtered
empty result, an outright grant error. This is **not** a bug in the
migration: this project's `stub_auth.sql` test harness (unlike a real
Supabase project) never grants `authenticated`/`anon` any table-level
privilege at all, only the RLS policies themselves — a real Supabase
project provisions the base grant automatically, with RLS then doing the
actual restricting. The fix was to the *test*, not the schema: look up
any id generated by an RPC (report ids, being `gen_random_uuid()`
defaults, aren't known in advance) as the superuser — this session's
default role, before any `SET ROLE` — stash it via `set_config()`, and
read it back via `current_setting()` from inside the role-switched block
that actually needs it, rather than ever re-querying the raw table while
impersonating a restricted role.

Tested end-to-end in `checklist_2_3.sql` with a real fixture (créateur A
— verified, fan B — a real supporter via a `livree` transaction, fan C —
a stranger, admin D): `signaler_publication()` rejects a stranger
reporting a soutiens-only post they can't fully see (leaving no row
behind) and accepts the same report from a real supporter, recorded with
the correct shape (`type=signalement`, `statut=en_attente`,
`publication_id` set); `masquer_publication()` rejects a non-admin,
and — once an admin calls it — the masked publication disappears from
both `publications_visibles` (even for its own auteur) and
`publications_accueil` immediately, with the underlying row otherwise
untouched; `traiter_signalement_publication()` rejects a non-admin,
`rejeter` sets the report to `rejete` while leaving the publication's
`masque` untouched, a second decision on an already-handled report is
rejected, and `masquer` both masks the publication and marks the report
`traite`; and the full `0020`/`0021` security-grant pattern holds for
all three new functions (`anon` has no `EXECUTE` on any of them,
`authenticated` with a `NULL auth.uid()` is rejected by each function's
own check, and `authenticated` still holds `EXECUTE` on all three).
Verified visually end-to-end too (same throwaway mock-Supabase/Playwright
technique used throughout this file): "Signaler" renders on both full
posts on `/home` and is absent from the locked teaser card, clicking it
flips to "Signalement envoyé.", and the admin's new "Publications
signalées" section renders the flagged content with both action buttons
— in both `fr` and `/en/`-prefixed sessions.

## Engagement on publications — likes, reposts, share counts, mute (Lot 5c, migration `0031`)

Follow-up to Lot 5b (migration `0030`, above). A fan or créateur can like a
publication, a verified créateur/admin can repost one, anyone can share a
permalink (now counted, not just copied), and a fan can mute a créateur
from their own `/home` feed. **Lot 5d (likes on other things, e.g.
comments) is not started here** — this lot is publications-engagement
only, same scoping discipline as every earlier lot in this sequence.

**Schema**: `publications_likes`/`publications_partages` (each
`publication_id, fan_id, created_at`, composite PK — a real per-fan
uniqueness guarantee, not just an app-level check) and
`publications_mutes` (`fan_id, createur_muet_id, created_at`, composite
PK, plus `check (fan_id != createur_muet_id)` — the DB-level half of the
self-mute rejection, mirrored by a friendlier RPC-level error, same
"defense in depth, constraint is the real guarantee" shape as every other
unique/check-backed rule in this project). None of the three tables has
an INSERT/UPDATE/DELETE policy for `authenticated` at all — same
"state machine only via a vetted RPC" pattern as `publications` itself;
every read a caller needs (counts, "did I already like/share/repost
this") is served through the views below, never a direct table read.

`publications` gained `autorise_repost text not null default 'tous'
check (... in ('personne', 'tous'))` (chosen by the ORIGINAL's own
author, same "the author controls it" shape as `visibilite`) and
`repost_de_id uuid references publications(id)` (no `ON DELETE` clause —
this codebase still has no publication-delete path at all, only masking,
so a dangling reference can never arise). `contenu`'s `NOT NULL` was
dropped and replaced with `publications_contenu_coherent`: a plain post
needs `repost_de_id is null` and a real 1–2000-char `contenu`; a repost
needs the opposite (`repost_de_id is not null` and `contenu is null`).
The original CHECK on `contenu`'s length is untouched and still holds
whenever `contenu` isn't null — a CHECK constraint never fails on NULL,
so nothing needed to change there. `idx_repost_unique` (a partial unique
index on `(auteur_id, repost_de_id) where repost_de_id is not null`) is
the real guarantee against two live repost rows for the same
`(auteur_id, repost_de_id)` pair ever coexisting;
`toggler_repost_publication()`'s own explicit check (below) exists only
to give a clean error message before ever hitting it. **Since migration
`0032` (see that section further down), the function checks "does a
repost already exist" *before* attempting to insert one, and toggles it
off instead of erroring** — so in normal operation this index is never
actually hit through the RPC at all; it stays as the real defense-in-depth
guarantee against a race between two concurrent calls both reaching the
insert step at once.

**Four new `SECURITY DEFINER` RPCs**, same discipline as every write RPC
since migration `0020` (`auth.uid() is null → raise`, `revoke all ...
from public` + `grant execute ... to authenticated` only — never `anon`,
unlike `peut_voir_publication_complete()`'s deliberate exception, since
every one of these four is a caller-specific action):

- **`toggler_like_publication(p_publication_id)`** — re-uses
  `peut_voir_publication_complete()` exactly as `signaler_publication()`
  already does (migration `0030`): "on ne peut pas aimer un teaser qu'on
  n'a pas lu", same eligibility rule as reporting. Toggles a row in
  `publications_likes` and returns `(liked, likes_count)` so the caller
  never needs a second round trip to learn the new count.
- **`toggler_repost_publication(p_publication_id)`** — reserved to verified
  créateurs/admins (the exact population `publier_message()` already
  authorizes, re-verified independently here, never trusted from a prior
  check). Every rejection condition is checked and reported individually
  — target not found, masked, non-public, `autorise_repost = 'personne'`,
  or already itself a repost, plus the shared rate limit (see below) — so
  both the SQL checklist and a real error message can tell them apart. On
  success, inserts a new `publications` row: `auteur_id` = the caller,
  `type` auto-assigned exactly like `publier_message()` (`annonce_fanboss`
  for an admin, `createur` otherwise), `contenu = null`, `repost_de_id` =
  the target, `visibilite` always forced to `'public'`. **As originally
  shipped in this lot, calling it a second time on the same target was
  rejected outright ("already reposted this publication") — migration
  `0032` (see that section further down) turned this into a real toggle
  instead: a second call deletes the existing repost, a third recreates
  it.** The rest of this bullet describes the function as it originally
  shipped; the eligibility/rejection logic on a genuinely first-time
  repost is otherwise unchanged.
  `visibilite` always forced to `'public'` — a restricted repost would be
  meaningless, since eligibility already requires the target to be public
  in the first place.
- **`partager_publication(p_publication_id)`** — deliberately **no**
  visibility check at all, unlike the other three: sharing a link reveals
  nothing the permalink page (below) doesn't already show that exact same
  viewer, so gating the RPC itself would just be a redundant, confusing
  second check. Idempotent via `on conflict do nothing` on
  `publications_partages`'s own primary key — a second share by the same
  fan never inflates the count. Returns the fresh `partages_count`.
- **`toggler_mute_createur(p_createur_id)`** — plain toggle on
  `publications_mutes`, rejecting a self-mute attempt with a clean error
  on top of the table's own CHECK. Returns `muted`.

**`publier_message()` itself gained a 4th parameter,
`p_autorise_repost`**, forced to `'tous'` for an admin's
`annonce_fanboss` post — same "server decides for this type, never the
client" rule already applied to `visibilite` for that exact type
(migration `0029`). The old 3-arg signature was **dropped outright**
(`drop function if exists publier_message(text, text, text);`) rather
than kept as a second overload — this project doesn't carry
backwards-compatibility shims, and the one caller (`POST
/api/publications`) was updated in the same change. **A real bug caught
empirically before it shipped, the same "reproduce before trusting"
discipline this file has followed since the pseudo-cooldown/`0020`/
`0029` bugs**: `toggler_repost_publication()`'s own OUT parameters (`id, type,
created_at`) shadow plain column references the exact same way
`creer_demande_verification()`/`publier_message()` already documented —
an unqualified `id` in its target-publication lookup raised "column
reference is ambiguous" against the OUT parameter instead of resolving
to the table column, caught by actually running the function against a
throwaway database (not assumed from reading the code) and fixed by
table-qualifying every column in that `select ... into`.

**Views**: `publications_visibles`/`publications_accueil` gain
`likes_count`, `partages_count`, `viewer_a_aime`, `viewer_a_partage`
(sub-selects/`exists()` on the new tables, same style as
`contenu_complet`'s own `peut_voir_publication_complete()` call) — plus
two more not explicitly listed in the original brief but needed to make
the rest of it actually work, flagged here rather than silently added:
`reposts_count` (the brief's own UI spec asks for a counter next to the
repost button, so this reuses the identical "count of rows referencing
this publication" shape as the two counts above, just counting
`publications` whose `repost_de_id` points back at this row instead of a
dedicated table) and `viewer_a_reposte` (the brief's own repost-button
eligibility rule includes "not already reposted by this viewer", which
needs a per-viewer flag the same way `viewer_a_aime` does —
`toggler_repost_publication()` re-checks this exact condition server-side
regardless, this is purely a UI signal to hide/disable the button ahead
of time).

**The masking cascade — the single most important behavior in this
lot, verified empirically (`checklist_2_3.sql`) before trusting it,
same discipline as every non-obvious Postgres mechanism in this
project**: a repost's own `masque` flag is not the only thing that can
make it disappear. `publications_visibles` now `left join`s back to the
referenced original (`orig`), and its `where` clause excludes a row
whenever `p.repost_de_id is not null and orig.masque = true` — so the
instant an admin masks the *original* (via the existing
`masquer_publication()`, migration `0030` — nothing about that function
changed), every repost pointing at it disappears from both
`publications_visibles` and `publications_accueil` too, even though the
repost row itself was never touched (`masque` stays `false` on it
forever — confirmed directly, not assumed). `orig` is `null` for a plain
post, so the added clause is a no-op for every row that isn't a repost.

**Mute is deliberately asymmetric between the two surfaces, flagged as
the second design decision worth stating plainly**: `publications_mutes`
is consulted **only** by `publications_accueil` (`/home`'s global feed),
never by `publications_visibles` (a créateur's own profile page,
`/@pseudo` or `/createur/[id]`). Muting someone is a personal
"stop showing me this in my feed" preference, not a block — a fan who
mutes a créateur can still deliberately visit that créateur's profile
and see everything exactly as before; only the passive, algorithmic
surface (`/home`) respects the mute. This mirrors real-world mute
semantics (Twitter/Instagram-style) rather than a block, and was
verified directly: the same fixture fan sees a muted créateur's posts
vanish from `publications_accueil` while `publications_visibles` for
that same créateur, queried by that same fan, is completely unaffected.

**Reposting deliberately consumes the exact same 10/24h rate limit as a
plain post — the first design decision worth stating plainly, since it
shapes how a future "why was my repost rejected" question should be
answered**: `toggler_repost_publication()`'s rate-limit check is the identical
query `publier_message()` already runs (`count(*) from publications
where auteur_id = caller and created_at > now() - 24h`) — since a repost
is a normal row in the same `publications` table (distinguished only by
`repost_de_id`/`contenu` being set or not), this single shared query
already counts posts and reposts together with zero special-casing
needed. A créateur who reposts 10 things in a day has no budget left to
also post normally until the window rolls over, and vice versa — this is
intentional, not an oversight: allowing reposts to bypass the limit (or
tracking them separately) would open a real spam vector (reposting is
strictly cheaper than composing original content), and this project's
whole `publier_message()` rate limit already exists specifically to cap
spam floods "regardless of who's posting" (migration `0029`'s own
wording) — a repost is just another kind of post from that lens.

**New route, `src/app/[locale]/[handle]/p/[id]/page.tsx`** — a
publication's permalink (`usefanboss.com/@pseudo/p/{id}`), nested one
level deeper than the existing `/[handle]` catch (no routing ambiguity —
Next.js treats a different segment count as a different route
regardless). Reuses `PublicationCard`/`PublicationTeaser` rather than
duplicating the teaser/`contenu_complet` rendering a second time, via a
new `getPublicationById()` (`src/lib/publications.ts`) that reads the
exact same `publications_visibles` view every other read path already
does. Like `/home`, this page deliberately does **not** redirect a
logged-out visitor — the whole point of a shareable link is that an
anonymous visitor can open it and see either the real content or a real
teaser, per their own actual visibility, not get bounced to `/login`
first. The URL's own `@handle` segment is re-verified against the
publication's real author (case-insensitive) rather than trusted —
`/@wrong-handle/p/{id}` 404s, same "never trust what the URL merely
claims" discipline as every other route in this project.

**Repost embedding in the UI**: `PublicationCard.tsx` was split into a
new internal `PublicationBody` (author row + contenu/image + badges,
extracted so a plain post and a repost's embedded original render this
identically rather than two slightly-different ways) plus the outer
card. A repost row shows a small "🔁 {reposter} a reposté" header (using
the *repost's own* auteur/type, so an admin's repost still shows the
FanBoss pill on this line) above the embedded original, itself
teaser-shaped for the current viewer via the exact same
`publications_visibles` row `getPublicationById`/`hydratePublications`
already fetched for it — a `soutiens`-only original a stranger reposted
still renders as a real locked teaser inside the repost card, never the
real content. Recursion is naturally capped at one level: the DB rejects
reposting a repost, so `repostDe.repostDe` is always `null`; the
`embedReposts` guard in `hydratePublications()` is a cheap defensive
no-op on top of that DB guarantee, not a real recursion limit.

**Icons** (`src/components/ui/icons.tsx`) are hand-made inline SVG —
this project has no icon library (`lucide-react` confirmed absent) and
otherwise leans on plain emoji, but the brief asked for these 4 buttons
specifically to get consistent SVG treatment. Every path uses
`currentColor`, never a hardcoded hex, so the wrapping button's own
Tailwind text-color class (`text-danger-500`, `text-accent-500`,
`text-foreground-muted`, ...) is what actually paints the icon in both
light and dark mode — same CSS-variable-driven discipline as everywhere
else in this app. `HeartIcon`/`ShareIcon` reuse one path each for both
outline (at rest) and filled (once liked/shared) states — real closed
shapes, so toggling `fill`/`stroke` is enough. `RepostIcon` has no
natural solid-fill body (a retweet loop is two open arrows around a
rounded rectangle, not a closed shape) — its "filled at the active
state" idea is expressed on the two arrowheads instead, which do have a
real area to fill; the loop body itself stays a stroked outline in both
states. `MenuIcon` (three parallel bars) has no active/inactive state —
it's a menu trigger, not a toggle.

**`PublicationActions.tsx`** — like → repost → partager → menu, exactly
per the brief's ordering. Like/share update local component state
directly from each RPC's own response (both already return the fresh
count, so there's no reason to re-fetch the whole page for one counter
to update); repost and mute instead call `router.refresh()`, since both
actually change *which rows* the page shows (a new repost row now
exists; a muted créateur's posts should vanish from `/home`), not just a
number on one card — same "local state for a counter, `router.refresh()`
for a real list change" split this project already uses elsewhere (e.g.
`ParametresForm`'s pseudo/bio saves vs. the admin managers'
`router.refresh()`-on-success pattern). The repost button only renders
when `canRepost && repostDe === null && visibilite === 'public' &&
autoriseRepost === 'tous' && !viewerARepost` — every one of those is
re-checked server-side by `toggler_repost_publication()` regardless, this is
purely what decides whether the button is worth showing at all.
`canRepost` is computed once per page (`canManagePublications()`,
`src/lib/publications.ts` — the exact same `est_admin ||
createur_verifie` query `/home`'s own composer-visibility check already
ran, now shared rather than duplicated a third time across `/home`,
`getCreateurProfileData`, and the new permalink page) and threaded down
through `PublicationsList`/`PublicationCard`, never re-derived per
publication. **`ReportPublicationButton.tsx` was deleted outright**
(confirmed unused via grep before deleting, not left as dead code) — its
logic moved into the "☰" menu inside `PublicationActions`, alongside the
new "Ne plus voir les publications de ce créateur" mute option, exactly
as the brief specified; a locked teaser still shows neither action,
since the menu itself only ever renders from the full-content branch
(`PublicationCard`'s own `contenuComplet` check already gates it, same
as before).

**Composer checkbox**: `PublicationComposer.tsx` gained "Autoriser le
repost par d'autres créateurs", checked by default, rendered only when
`visibilite === "public"` — hidden rather than shown-disabled for
`soutiens`, since the value is genuinely inert in that case
(`toggler_repost_publication()`'s own `visibilite` check already rejects any
non-public target regardless of `autorise_repost`, so there's nothing
for the hidden checkbox's value to have affected either way).

**Follow-up (same lot, second pass): the author photo/name were not
clickable, and the visual pass this section originally flagged as
skipped was then actually done.** `PublicationBody`'s full-content
branch rendered the photo/name as plain markup, never wrapped in the
`Link` to `auteurHrefFor(auteur)` that `PublicationTeaser` already used
for its own CTA — a real, reachable bug (every comparable platform makes
the avatar/name clickable), fixed by wrapping that header block in a
`Link`, matching the teaser's existing pattern exactly.

Fixing it was the trigger for finally building the throwaway
mock-Supabase/Playwright harness this section had flagged as skipped —
same technique used for essentially every earlier lot: a small Node HTTP
server mocking the Auth (`/auth/v1/token`, `/auth/v1/user`) and
PostgREST REST/RPC surface, a real `next dev` pointed at it, and a
scripted Chromium session logging in as a real fixture user and clicking
through the actual UI. **This caught two more real bugs the SQL
checklist alone could not, precisely because they're UI-layer, not
DB-layer**:

1. **The `☰` menu dropdown (`z-20`) could render underneath
   `AppTabBar`'s fixed bottom nav (`z-40`)** — reproduced live: Playwright
   reported the tab bar's own `<Link>` "intercepts pointer events" when
   trying to click "Ne plus voir les publications de ce créateur" on a
   card near the bottom of the viewport. Fixed by raising both the menu
   panel and its outside-click catcher to `z-50`, matching this project's
   existing convention for an overlay that must always win over the tab
   bar (`ZoomablePhoto`/`PhotoCropper`).
2. **A locked teaser rendered a full action bar underneath it** — `like`,
   `repost`, `partager`, and the `☰` menu all appeared on a `soutiens`-only
   post a stranger couldn't see, even though this section's own text
   above already (incorrectly) claimed "a locked teaser still shows
   neither action." Clicking like on one would have hit
   `toggler_like_publication()`'s real server-side rejection
   ("cannot like a publication you cannot fully see") — the DB guarantee
   held, but the UI offered an action doomed to fail. Fixed by gating
   `PublicationCard`'s entire action-bar block on
   `publication.contenuComplet` — which, for a repost row, is *always*
   `true` regardless of its embedded original's own lock state (a
   repost's own `visibilite` is forced `'public'` by
   `toggler_repost_publication()`, so `peut_voir_publication_complete()` takes
   the unconditional-`public` branch for the repost row itself), so this
   one check correctly keeps a repost's action bar visible even when the
   original it embeds is locked.

Verified live, in French and English, light and dark mode, via the
harness above: the composer checkbox appears only when `visibilite`
is `public` and disappears for `soutiens`; a submitted post appears
immediately; like toggles the heart fill and count; the clickable
author link (this fix) navigates to `/@handle` from both a plain card
and — separately — from inside an embedded repost's body; reposting
shows the "🔁 {reposter} a reposté" header with the embedded original,
and the repost's own action bar correctly omits its own repost button;
partager copies the real `/@pseudo/p/{id}` permalink to the clipboard;
the `☰` menu (now fully clickable at every scroll position) reports and
mutes correctly, with the mute asymmetry directly observable — a muted
créateur's plain post vanishes from `/home` while a repost of her
content (authored by someone else, not muted) stays, and her own
profile page is completely unaffected; the locked teaser shows no action
bar at all; and both permalink-page states (full content, locked teaser)
render correctly. The full `npm test`/`npm run tsc`/`npm run lint`/
`npm run test:sql` suite was re-run after each fix and passes.

Tested end-to-end in `checklist_2_3.sql` with a real fixture (créateur A
— verified, posts the originals; créateur B — verified, reposts;
fan C — a stranger to A, not verified/admin; admin D — not itself
`createur_verifie`; fan E — a real supporter of A via a `livree`
transaction): `toggler_like_publication()` toggles on then off with the
count following correctly, rejects liking a `soutiens`-only post a
stranger can't fully see (no row left behind), and rejects a `NULL
auth.uid()`; `toggler_repost_publication()` rejects, individually, a
non-verified/non-admin caller, a `soutiens`-only target, a target with
`autorise_repost = 'personne'`, a masked target, a double-repost of the
same target by the same author, and reposting a repost — then succeeds
for a genuinely eligible caller/target, with `type` auto-assigned to
`createur`; the shared rate limit rejects an 11th action (a repost, on
top of 1 repost + 9 plain posts already made) with no row left behind;
the masking cascade is proven directly — a repost is visible in both
views, then disappears from **both** the instant its referenced original
is masked, while the repost's own `masque` flag is confirmed to stay
`false` throughout; `partager_publication()` is confirmed idempotent
(two calls from the same fan leave the count at 1, with exactly one
`publications_partages` row, not two); `toggler_mute_createur()` rejects
a self-mute attempt, and the asymmetry is proven directly (a muted
créateur's posts vanish from `publications_accueil` while
`publications_visibles` for that same créateur is unaffected, for the
same querying fan), with a second toggle call confirmed to actually
un-mute; and the full `0020`/`0021` security-grant pattern holds for all
four new functions plus the updated 4-arg `publier_message()` (`anon`
has no `EXECUTE` on any of them, `authenticated` with a `NULL
auth.uid()` is rejected by each function's own check, and
`authenticated` still holds `EXECUTE` on all five).

## Créateur self-masking + authorship-aware menu + repost toggle (Lot 5c follow-up, migration `0032`)

A second follow-up to Lot 5c (after the clickable-author-link/z-index/
teaser-action-bar fixes documented above): a créateur can now hide their
own publication directly, the "..." menu shows different options
depending on whether the viewer authored the row being looked at, and
reposting became a real toggle instead of a one-way action.

**`masquer_ma_publication(p_publication_id)`** is self-only and
deliberately **one-way** — no boolean parameter at all, unlike the
admin-only `masquer_publication()` (migration `0030`), which still takes
`p_masque boolean` and can flip either direction. A créateur can pull
their own post down, but can never bring it back up themselves; only an
admin can reverse that via the existing `masquer_publication()`. This is
a deliberate asymmetry, not an oversight: if self-unmasking existed, a
créateur could use it to route around a moderation decision made against
them (an admin masks a publication via `masquer_publication()`, the
créateur immediately un-masks their own row again) — removing that
parameter entirely, rather than adding an ownership check that still
permits both directions, is what actually closes that gap. Same
`SECURITY DEFINER` + `auth.uid()`-null-check + `revoke/grant` discipline
as every write RPC since migration `0020`: re-verifies `auteur_id =
auth.uid()` internally (raising `'not authorized: you can only hide your
own publications'` otherwise, distinct from `'publication not found'`
for a genuinely unknown id, same "tell the two failure modes apart"
granularity as every other RPC in this project), then sets `masque =
true` unconditionally. Calling it again on an already-masked row is a
harmless no-op success (masque was already true, stays true) — not an
error, since there's no meaningful "already hidden" failure state to
report.

**`toggler_repost_publication(p_publication_id)`** replaces
`reposter_publication()` outright — same rename discipline as
`publier_message()`'s 3-arg → 4-arg change in migration `0031`
(`drop function if exists reposter_publication(uuid);`, no overload kept,
the one caller updated in the same change; this project doesn't carry
backwards-compatibility shims). `p_publication_id` is always the
**original's** id, exactly as before, never the repost's own id — same
convention as `toggler_like_publication`/`toggler_mute_createur`.

The toggle-off branch is a **real `DELETE`**, not a `masque` flip, and is
checked in the function **before** any of the target's own
masked/visibilite/autorise_repost gates — those only matter when
*creating* a new repost. Undoing an existing one must keep working even
if the original was masked afterward or its author flipped
`autorise_repost` to `'personne'` in the meantime; there's no reason to
trap a créateur into a repost they can no longer remove. The "target is
itself a repost" check stays unconditional and first, since it's a
structural property of the target that applies to both directions
identically (a repost of a repost could never have been created in the
first place, so there's never an existing one to toggle off either).

**Why a real `DELETE` is safe here specifically, unlike for an original
post** — this is the one design decision worth stating plainly, since it
explains why this codebase still has no general publication-delete path
anywhere else: a repost can never itself be the target of another row's
`repost_de_id` (`toggler_repost_publication()`'s own "cannot repost a
repost" check guarantees this, on both the create and toggle-off paths),
so **nothing ever references a repost** — no foreign key can ever block
deleting one. A repost also never carries its own `contenu`/
`image_r2_key` (`publications_contenu_coherent` requires both `null`
whenever `repost_de_id` is set), so there is nothing on R2 to clean up
either. Deleting it is a genuine reversal ("never happened"), which is
also why it's structurally distinct from `masquer_ma_publication()` — a
créateur hiding their own original content keeps a record (an admin can
still see and rule on a masked row); un-reposting something erases it
completely, which is fine precisely because a repost has no content of
its own to lose.

**This RPC can never delete a row that isn't a repost** — not by
convention, but because the `DELETE`'s own `WHERE` clause
(`auteur_id = caller AND repost_de_id = p_publication_id`) can
structurally only ever match rows that satisfy `repost_de_id is not
null`, which `publications_contenu_coherent` ties directly to "this row
is a repost with no `contenu` of its own." Calling this function with
`p_publication_id` set to one of the caller's own *plain* posts (one
nothing has reposted yet) finds no matching row and falls through to the
create path instead — inserting a *new* repost of that plain post,
leaving the original completely untouched. Verified directly, not
assumed (`checklist_2_3.sql`): the target's `contenu` is read before and
after the call and confirmed identical.

**Quota release, the natural consequence of the second point being an
actual `DELETE`**: `publier_message()`'s and this function's own rate
limit (`count(*) from publications where auteur_id = caller and
created_at > now() - interval '24 hours'`) is a live count, not a
separately-tracked counter — deleting a repost row removes it from that
count immediately, freeing a slot for a new post or repost within the
same 24h window. No special-casing was needed to make this true; it
falls directly out of reusing the exact same query
`toggler_repost_publication()` already had. Verified directly: a
créateur at exactly 10/10 (including one repost) has a new repost
rejected by the rate limit, then — after toggling that one repost off —
successfully reposts a different target, still within the same 24h
window.

**The authorship-aware "..." menu** (`PublicationActions.tsx`) fixes a
real UX gap: the menu used to show "Signaler"/"Ne plus voir les
publications de ce créateur" unconditionally, even on the viewer's own
publications, where neither option makes sense (you can't meaningfully
report or mute yourself). It now branches on `viewerId === publication.
auteur.id` — the top-level card's own author, i.e. the **reposter** for
a repost row, not the embedded original's author, since the menu always
acts on the card's own `publication.id` regardless of whether it's a
plain post or a repost (a créateur can hide a repost they made, exactly
like a plain post). `viewerId` is threaded down from a new
`getViewerContext()` (`src/lib/publications.ts`, replacing the old
`canManagePublications()` — same `est_admin || createur_verifie` query,
now also returning the caller's own id) through `PublicationsList` →
`PublicationCard` → `PublicationActions`, computed once per page exactly
like `canRepost` already was, never re-derived per card.
`masquer_ma_publication()`/`signaler_publication()` both re-verify
ownership/eligibility server-side regardless of what the menu shows —
same "never trust the client alone" discipline as everywhere else in
this project; `viewerId` only decides which button(s) render.

**The 🔁 repost button no longer disappears once the viewer has
reposted** — it used to (Lot 5c's original one-way design: hide the
button, since there was nothing further to do). Now it stays visible and
its own fill state (`RepostIcon`'s `active` prop, same outline-vs-filled
convention as the heart/share icons) reflects whether the viewer has
already reposted, toggling on click. Eligibility to *show* the button at
all is now `canRepost && repostDe === null && (reposted ||
(visibilite === 'public' && autoriseRepost === 'tous'))` — the button
stays visible to allow toggling off even if the underlying gates would
now block a *new* repost (mirroring `toggler_repost_publication()`'s own
"toggle-off checked before the create-path gates" ordering). Clicking it
calls the same `/api/publications/[id]/repost` route (unchanged path,
now wrapping the renamed RPC) and applies the RPC's own `reposted`
return value to local state either direction, then `router.refresh()`s
regardless of direction — both a new repost appearing and an existing
one disappearing change *which rows* the page shows, not just a counter
on one card.

Tested end-to-end in `checklist_2_3.sql` with a real fixture (créateur A
— verified, créateur B — verified, fan C — a stranger, admin D):
`masquer_ma_publication()` rejects a non-owner (leaving `masque`
untouched) and succeeds for the owner, with the masked row confirmed
gone from `publications_visibles`; a second call on an already-masked
row is confirmed to leave it masked forever (no unmask path exists);
`toggler_repost_publication()` still rejects every original condition
individually on a first-time repost (non-verified/non-admin caller,
non-public target, `autorise_repost = 'personne'`, a masked target, and
reposting a repost); the toggle itself is proven directly across a full
create → delete → create cycle, with the delete independently confirmed
at the database level (not just via the RPC's own return value); it
never deletes a row that isn't a repost (a plain post survives the call
completely unchanged); the quota-release chain is proven end to end (at
the rate limit, a new repost is rejected; toggling an existing repost off
frees a slot; a new repost then succeeds); the old `reposter_publication`
name is confirmed gone outright (`undefined_function`, not merely
inaccessible); and the full `0020`/`0021` security-grant pattern holds
for both new/renamed functions. The authorship-aware menu and the
repost button's fill-state toggle are UI-only and were verified visually
instead (fr/en, light/dark) — see that pass's own notes for what was
specifically checked.

## Admin "Publications signalées": repost-aware content + permalink (Lot 5c follow-up, no migration)

A gap left over from Lot 5c's repost feature (migration `0031`): the
admin worklist for flagged publications (`/admin`'s "Publications
signalées", Lot 5b) only ever selected `publications(contenu)` on the
reported row. Once reposts existed, a signalement on a repost showed a
**blank** content card — a repost's own `contenu` is always `NULL`
(`publications_contenu_coherent`) — with no indication why, and no way
for the admin to see what was actually flagged in its real context (a
locked embedded original, badges, image). Pure admin-side query/UI fix,
no schema change and no new migration.

**`buildPublicationSignalee()` (`src/lib/adminPublicationsSignalees.ts`)**
is a new pure function, extracted specifically so this logic is
unit-testable without a DOM or a real Supabase client — same discipline
as `classifyPaiementRecu()`/`computeCampagneStatus()` elsewhere in this
codebase. `/admin/page.tsx`'s reports query now selects
`publications(id, contenu, repost_de_id)` (was just `contenu`), then a
second, dependent service-role query fetches `id, contenu, auteur_id`
for every distinct `repost_de_id` that actually showed up among pending
signalements — run after the page's main `Promise.all` since it needs
those ids first. `buildPublicationSignalee()` then decides, per row:
when `repost_de_id` is set, show the **original's** `contenu` (never the
repost's own, always-null one) and set `isRepost = true` with a
`repostOriginalLabel` (`@pseudo` of the original's author, preferred
since it's what an admin can actually act on, falling back to a
resolved display-name label, then `t("deletedUser")` if the original
can't be found at all — defensive only, since this codebase has no
delete path for anything but a repost row).

**The permalink always targets the REPORTED publication, never the
original** — `id`/`pseudo` on the returned `PublicationSignalee` come
from the reported row itself (`reported_user_id`, which
`signaler_publication()` always sets to the reported publication's own
`auteur_id` — migration `0030`), specifically so the admin's "Voir la
publication signalée" link (`/@pseudo/p/{id}`, the Lot 5c permalink
page) opens exactly what the reporter saw and flagged — a repost's own
card, with its embedded (possibly locked) original — not a different
page for the original alone. No link renders at all when the reported
author never set a pseudo, since the permalink page 404s on a missing
pseudo by design (see "Public handle" above) — linking to a route
guaranteed to 404 would be worse than no link.

**`PublicationsSignaleesManager.tsx`** now imports its `PublicationSignalee`
type from the new lib module instead of declaring its own (one
definition, not two that could drift), renders a `"Repost de {auteur} :"`
line above the content bubble only when `isRepost` is true, and the new
permalink link via the locale-aware `Link` from `@/i18n/navigation`
(`target="_blank"` — same "open it in full context before deciding"
reasoning as `VerificationsManager`'s external `lienCompte` link).

Covered by `src/lib/__tests__/adminPublicationsSignalees.test.ts`: a
plain-post signalement shows its own contenu; a repost signalement
resolves the original's contenu (asserted `!== ""`, the exact failure
mode this fix closes) and the correct `@pseudo` indicator, with the
permalink `id`/`pseudo` still pointing at the repost, not the original;
a missing-pseudo original falls back to a display-name label; and a
genuinely-missing original (defensive only) falls back to the
deleted-user label without erroring. No SQL test was added — this is a
TypeScript query/UI fix reading columns that already existed, not a new
DB constraint/trigger/RPC.

Verified visually end-to-end (same throwaway mock-Supabase/Playwright
technique used throughout this file, extended with an admin fixture user
and `reports`/raw-`publications`/`/auth/v1/admin/users` mock support): a
repost signalement shows "Repost de @sergio :" above the original's real
text (never blank) with a working permalink that opens the actual
reposted card (embedded original included) in a new tab, while a
plain-post signalement in the same list shows no repost indicator — in
both `fr` (light) and `/en/` (dark).

## Admin dashboard reorganized into 4 top tabs (no migration)

`/admin` had grown into 8 stacked sections with no grouping, all always
visible on one long scroll. Reorganized into 4 tabs: **Vue d'ensemble**
(the month's stats + top créateurs, both read-only), **Financier**
(Remboursements manuels + Litiges + Retraits), **Contenu & confiance**
(Vérifications créateur + Publications signalées), **Administration**
(Gestion des admins).

**Deliberately top tabs, not the bottom `AppTabBar` the créateur-facing
`(app)` route group uses** — that one is a mobile-PWA pattern (fixed
`inset-x-0 bottom-0`, per Lot 3); `/admin` is a business-only, desktop-
first tool, so `AdminTabs.tsx` is a plain top-of-page tab row instead,
visually modeled on the existing `ProfileTabs.tsx` (underline-on-active,
`border-b`) rather than introducing a second competing tab-bar style.

**Same "pre-built ReactNode per tab" pattern as `ProfileTabs.tsx`** — all
4 tabs' content is still rendered server-side by `AdminPage` exactly as
before (same JSX, same data, same `<section>`s) and handed into
`AdminTabs` as props; the client component only toggles which one is
visible (`hidden`, not conditional rendering, so a Manager's own
in-flight `pendingId`/`errorById` state is never reset by switching
tabs away and back). **No `*Manager` component's internal logic
changed at all** — this is purely which page groups which section,
confirmed by diff: every `RemboursementsManuelsManager`/`LitigesManager`/
`RetraitsManager`/`VerificationsManager`/`PublicationsSignaleesManager`/
`GestionAdminsManager` call site is byte-identical to before, just
nested one level deeper.

**Badges**: only Financier and Contenu & confiance carry one — Vue
d'ensemble and Administration are plain reads with nothing to triage,
per explicit instruction. `financierCount` = remboursements +
litiges + retraits (all already-filtered-to-pending arrays' lengths
summed) and `contenuConfianceCount` = verifications + publications
signalées, computed once in `AdminPage` and passed down as plain
numbers — `AdminTabs` itself decides whether to render the pill
(`count > 0`), same "hide at zero" convention every individual section
heading already used before this reorg (a bare tab label at 0, not a
"(0)" pill, mirroring `{count > 0 && <span>...}` throughout this page).

Covered by the existing `src/app/[locale]/admin/__tests__/page.test.ts`
(unchanged assertions — the page still renders/still calls the same
service-role queries, this reorg only touches how the JSX result is
shaped) — no new unit test was needed for the tab-switching itself
since it's pure client-side UI state, same reasoning `ProfileTabs.tsx`
was never unit-tested either.

Verified visually end-to-end (same throwaway mock-Supabase/Playwright
technique, extended with a deliberately empty Financier fixture set
specifically to exercise the zero-badge case alongside Contenu &
confiance's non-zero one): Vue d'ensemble is the default active tab;
clicking each of the other three swaps the visible content and leaves
the others hidden; Financier's tab shows no badge at all (0 pending) while
Contenu & confiance shows "2"; the repost signalement fix from the
section above renders correctly inside its new Contenu & confiance
home, permalink included; and all of the above holds in both `fr`
(light) and `/en/` (dark).

## Security audit fixes: video duration cap, R2 upload size limits, `/home` login requirement (migration `0033`)

Three independent fixes from an explicit security audit request.

### 1. Video duration cap (video/shoutout delivery), + a real gap it exposed

A créateur delivering an accepted video/shoutout transaction must not be
able to upload an arbitrarily long video. The check happens at file
*selection* time, before any upload starts: `src/lib/videoDuration.ts`
exports `MAX_VIDEO_DURATION_SECONDS = 90`, a pure `isVideoDurationAllowed()`
(unit-tested, same DOM-free-vs-DOM-touching split as
`src/lib/imageCrop.ts`), and `readVideoDurationSeconds(file)` — a
throwaway `<video preload="metadata">` element, not unit-tested directly
(no jsdom in this project), that resolves near-instantly since the
browser only needs to parse the container header, never decode the whole
file. This is what "traite la vraie cause" means here: an overly long
video is *why* the file is large in the first place, so rejecting it at
selection time (with a clear message) is the real fix; migration point 2
below is the safety net behind it, not a substitute.

**A real, surprising gap was found while wiring this in and confirmed
before building anything**: grepping the entire `src/` tree turned up
*zero* créateur-facing UI for delivering an accepted video/shoutout
transaction at all. `/api/transactions/[id]/upload-url` and the
`deliver_video()` RPC (migration `0002`) both already existed and both
still work exactly as documented elsewhere in this file — nothing was
ever wired to call them. `DemandesEnAttente.tsx` only lists `en_attente`
transactions (accept/refuse); the instant one is accepted it moves to
`validee` and simply vanished from the créateur's view, with no page
anywhere querying `statut = 'validee'` transactions for their own
`createur_id`. Confirmed with the user before proceeding (this expands
"add a duration check" into "also build the missing delivery flow the
check needs to attach to") rather than silently either skipping the
duration check's own visual test or building an unrequested feature.

**`LivraisonsEnAttente.tsx`** (new) is the built delivery UI — same
repeatable-row pattern as `DemandesEnAttente.tsx`: file select → duration
check (reject inline, clear the file, before any network call) → POST
`/api/transactions/[id]/upload-url` (now with `size`, see point 2) → PUT
to R2 → POST `/api/transactions/[id]/deliver`. Wired into `/offres`
(`(app)/offres/page.tsx`) via a new query — `transactions` where
`createur_id = auth.uid() and statut = 'validee'` — with no explicit
offer-type filter needed: per this app's own transaction lifecycle
(documented above), only `video`/`shoutout` transactions ever sit at
`validee` waiting on the créateur at all (every other type either
cascades straight through to `livree` or skips `validee` entirely), same
reasoning `DemandesEnAttente`'s own `en_attente` query already relies on.
New section "Livraisons en attente", right after "Demandes en attente"
(accept, then deliver is the natural reading order). `Dashboard.livraisons.*`
i18n keys, reusing the `Dashboard` namespace like every other `/offres`
section per Lot 3's own "don't rename what isn't user-visible" rule.

### 2. R2 upload size limit — the safety net behind point 1, and the only real guarantee for images

`getSignedUploadUrl()` (`src/lib/r2.ts`) used to sign no size limit at
all — any caller could request a URL for a small declared `ContentType`
and then PUT an arbitrarily large file. This matters even more for
uploads with no duration concept at all (profile photos, publication
images) — point 1's client-side check has nothing to attach to there,
so this is their *only* real limit.

`MAX_UPLOAD_SIZE_BYTES = { image: 10 MB, video: 200 MB }`,
`maxUploadSizeBytes(contentType)` (prefix-based: `image/*` → the image
cap, everything else — including `contenu_debloque`'s arbitrary
créateur-supplied content type — falls back to the more permissive video
cap, since a legitimate unlockable file might be neither an image nor a
video), and `checkUploadSize(size, contentType)` (pure, unit-tested) are
called by **every** upload-url route
(`profil/photo-upload-url`, `publications/upload-url`,
`offres/[id]/content-upload-url`, `transactions/[id]/upload-url`)
*before* ever minting a signed URL — a request whose declared `size`
exceeds the cap gets a clean 400, `getSignedUploadUrl()` never called at
all (asserted directly in each route's own test via a `getSignedUploadUrl`
spy).

**Why this is a real server-side guarantee, not just an early
client-reported check**: `getSignedUploadUrl(key, contentType, contentLength)`
now signs `ContentLength` into the `PutObjectCommand`, the same way this
codebase already established `ContentType` gets signed and enforced (see
"Mobile upload bug" above — a `ContentType` mismatch between what was
signed and what's actually PUT is already confirmed, empirically, to
make R2 reject the request outright). A caller can declare a small,
passing `size` in the initial request to get past `checkUploadSize()`,
but the actual PUT's `Content-Length` header is computed automatically
by the browser from the real file being sent — it isn't something `fetch`
lets a caller override — so uploading anything larger than what was
signed fails R2's own signature verification, independent of any
application code. This wasn't re-verified against a real R2 account (none
exists in this sandbox, same limitation flagged for the CinetPay refund
stub and the GoTrue wrapper-text guess elsewhere in this file) — it's a
direct extension of a mechanism this codebase has already empirically
confirmed for the sibling `ContentType` field on the exact same signed
URL, not a fresh, unverified assumption.

Every client call site that requests an upload URL now sends
`size: file.size` alongside `contentType` (`ParametresForm.tsx`,
`PublicationComposer.tsx`, `OffresManager.tsx`'s `contenu_debloque`
upload, and the new `LivraisonsEnAttente.tsx`).

### 3. `/home` now requires a session; `publications_accueil` loses its `anon` grant

Reverses Lot 5a's own original design decision (`/home` was built to be
"publicly browsable while logged out," per that section's own comment,
so an anonymous visitor could see public posts and a locked teaser for
`soutiens`-only ones). Per this audit, `/home` now redirects a logged-out
visitor to `/login` — the same `auth.getUser()` + `redirect()` guard
every other `(app)` page (`/dashboard`, `/finance`, `/offres`,
`/parametres`) already uses.

**`publications_visibles` is deliberately untouched, still granted to
both `authenticated` and `anon`** — it backs `/[handle]` (a créateur's
public profile) and `/[handle]/p/[id]` (the Lot 5c permalink page), both
of which must stay reachable by a logged-out visitor; that's the entire
point of a shareable public profile/permalink, and revoking `anon` there
would break external sharing outright. Only `publications_accueil` (the
`/home` feed, confirmed via grep to have no other reader anywhere in
`src/`) loses its `anon` grant: `revoke select on public.publications_accueil
from anon;` (migration `0033`). The `/home` redirect is what makes this
revoke safe — `getPublicationsAccueil()` is now only ever called for an
authenticated caller.

**Three pre-existing SQL checklist tests from Lot 5a/5c had to be updated
in place, not just described** — they queried `publications_accueil` as
`anon`, which is now a real permission error instead of an empty/filtered
result. Each was switched to `authenticated` (with a real fixture user
id) for the `publications_accueil` half of the assertion specifically,
while any co-located `publications_visibles` check in the same test stays
on `anon` (still correct, still the point being proven). This is the same
"a later migration invalidates an earlier test's assumption, so the old
test itself gets updated, never just left describing stale behavior"
discipline already established for the Lot 5c repost-toggle test rewrite
in migration `0032`.

Tested end-to-end in `checklist_2_3.sql`, not just described: `anon` gets
a real `insufficient_privilege` error attempting to `SELECT` from
`publications_accueil` at all (both via a direct attempted query and via
`has_table_privilege`), while the identical check against
`publications_visibles` still succeeds for `anon`; `authenticated` still
holds `SELECT` on `publications_accueil` (logged-in users must keep
working). Also covers `checkUploadSize()`/`maxUploadSizeBytes()` directly
(`r2.test.ts`) and `isVideoDurationAllowed()` (`videoDuration.test.ts`),
both at their exact boundary (90s/the byte cap passes, one over either
fails); route-level tests for `transactions/[id]/upload-url` and
`publications/upload-url` proving an oversized declared `size` is
rejected with 400 *before* `getSignedUploadUrl()` is ever called — the
real server-side rejection this fix is about, not merely a client-side
check a direct API caller could skip; and a `/home` page test proving a
logged-out visitor is redirected to `/login` without `getPublicationsAccueil()`
ever being called, while a logged-in visitor renders normally.

Verified visually end-to-end (same throwaway mock-Supabase/Playwright
technique used throughout this file): selecting a video longer than 90s
in the new "Livraisons en attente" form shows the French error message
immediately, with no network request ever fired; visiting `/home` while
logged out redirects straight to `/login`; and the `/[handle]/p/[id]`
permalink page, opened in a fresh logged-out context, still renders the
real publication (or a real teaser, per its own visibility rules)
exactly as before, confirming the `anon` grant revoke was correctly
scoped to `publications_accueil` alone.

## In-app notifications — schema + wiring (Lot 6a, migration `0034`) + the bell (Lot 6b)

A créateur or fan gets a real, persisted notification (bell badge +
dropdown) for every event that has an actual recipient worth telling:
their request was accepted/refused, their video was delivered, a fan
confirmed/disputed a delivery, a litige was resolved, a withdrawal was
processed, a publication was liked. Given exactly as specified —
`notifications` (`destinataire_id, type, transaction_id, publication_id,
acteur_id, lu, created_at`), the `type` CHECK constraint enumerating all
12 event types, and one shared insertion helper.

**`creer_notification()` is the single insertion path, called from
every wired-in function below and the webhook — never a raw `INSERT`
anywhere else.** It's deliberately the one `SECURITY DEFINER` RPC in this
entire project with **no internal authorization check of its own**: it
takes an arbitrary `p_destinataire_id`/`p_acteur_id` and just inserts.
This is safe specifically because of the grant: `revoke all ... from
public; grant execute ... to service_role;` — **not** `authenticated`.
Every real call site is either (a) a call from *inside* another
`SECURITY DEFINER` function owned by the same role — which, per
Postgres's own security-definer semantics, executes with that owner's
privileges once inside, so it needs no separate grant to call a
same-owner function at all — or (b) the CinetPay webhook, via the
service-role client, for transaction creation (the one event with no
wrapping RPC to attach to). **Verified empirically before trusting this,
not assumed**: a throwaway database confirmed `authenticated` gets a real
`insufficient_privilege` calling `creer_notification()` directly, while
`accept_transaction()` (called by that same `authenticated` role)
successfully creates a real notification row via its own internal call —
proving the ownership-based privilege propagation actually works, not
just in theory. If `creer_notification()` were ever mistakenly granted to
`authenticated` directly, any logged-in user could insert a fake
notification impersonating any acteur, for any recipient — this grant
shape is what a `0020`/`0021`-style audit would flag.

**Wiring — one `creer_notification()` call added to each existing
function, right before (or as part of) its own final state change,
`create or replace` with an identical signature so no existing `EXECUTE`
grant needs restating** (same precedent as migration `0025`'s own
`deliver_video()` redefinition):
- `accept_transaction()` → `demande_acceptee` to the fan, créateur as
  acteur. Fires once regardless of whether this cascades straight to
  `livree` for whatsapp (acceptance IS delivery there) — there's no
  separate "whatsapp delivered" type; `demande_acceptee` already covers
  it. Only `deliver_video()`'s own `video_livree` is video/shoutout-
  specific.
- `refuse_transaction()` → `demande_refusee` to the fan.
- `deliver_video()` → `video_livree` to the fan.
- `confirmer_livraison_fan()` → `confirmation_recue` to the créateur,
  fan as acteur.
- `contester_livraison_fan()` → `contestation_recue` to the créateur,
  fan as acteur.
- `resoudre_litige()` → `litige_tranche_createur` (destinataire =
  créateur) or `litige_tranche_fan` (destinataire = fan), whichever the
  decision favored — the type name literally names the recipient, so the
  branch is a direct `case` on `p_decision`, admin as acteur. Needed a
  `select * into v_tx` added first (the original had none, going
  straight to `UPDATE`) to have `fan_id`/`createur_id` available.
- `traiter_retrait()` → `retrait_traite`/`retrait_refuse` to the
  créateur who requested it, admin as acteur, `transaction_id`/
  `publication_id` both left null — this event is about a
  `demandes_retrait` row, neither of those tables.
- `toggler_like_publication()` → `publication_aimee` to the publication's
  auteur, liking fan as acteur — **only on the like branch, never
  unlike** (undoing a like isn't an event worth surfacing), and **never
  when `auteur_id = v_user_id`** (a self-like notifies nobody; there's
  no one to tell).
- **CinetPay webhook** (`src/app/api/webhooks/cinetpay/route.ts`), right
  after the transaction `INSERT` succeeds: `demande_recue` to the
  créateur for any type with an acceptation step (video/shoutout/
  whatsapp — i.e. not in `TYPES_A_VALIDATION_IMMEDIATE`), `don_recu` for
  `don`/`campagne` (a contribution, no action needed). **Deliberately
  silent for `contenu_debloque`/`evenement_live`** — neither "a request"
  nor "a don" describes a pre-configured purchase, and the `type` CHECK
  constraint has no third label for it; flagged as a deliberate scope
  limit rather than forcing one of the two existing types onto an event
  they don't describe. The RPC call is never allowed to fail the webhook
  itself (`console.error` and move on) — the transaction is already
  safely recorded by that point, and a missed bell notification isn't
  worth turning a successful payment into a 500 CinetPay might retry.

**`marquer_notifications_lues()`** marks every one of the caller's own
unread notifications read in a single call — there is deliberately no
per-notification "mark as read" RPC. This shapes the whole bell UI (Lot
6b, below): opening the dropdown marks the entire batch read immediately;
clicking an individual row only ever navigates, since by the time it's
clickable the mark-all-read call has already fired.

Tested end-to-end in `checklist_2_3.sql` with a real fixture (créateur A,
fan B, admin D — not itself `createur_verifie`): every one of the 8 wired
functions produces exactly the right notification row (correct
`destinataire_id`/`type`/`transaction_id`/`acteur_id`) for a real state
transition; a self-like and an unlike both leave the `publication_aimee`
count unchanged at 1 (proven by driving all three actions — B's like, A's
self-like, B's unlike — against the same publication and asserting the
final count, not just that no error was raised); `marquer_notifications_lues()`
marks only the caller's own notifications read, leaving another user's
untouched; and the full grant-audit pattern holds (`authenticated`/`anon`
both rejected on a direct `creer_notification()` call, `service_role`
confirmed to still hold `EXECUTE` on it, `anon` rejected and a `NULL
auth.uid()` rejected on `marquer_notifications_lues()`). Also covered at
the route level (`src/app/api/webhooks/cinetpay/__tests__/route.test.ts`):
a video-type transaction fires exactly one `creer_notification` RPC call
with `type: "demande_recue"`; a don fires one with `type: "don_recu"`;
`contenu_debloque`/`evenement_live` fire zero; and a `creer_notification`
RPC failure is confirmed to leave the webhook's own 200 response and
`status: "ok"` body completely unaffected.

### The bell (Lot 6b)

`NotificationBell.tsx` lives in the shared `(app)` layout, next to
`CopyProfileLinkButton` — same "identity-level, not tied to one tab"
reasoning that already placed the profile-link card there (Lot 3).
Notifications and the unread count are pre-fetched server-side by the
layout and handed in as props, same "pre-built content, client only
toggles visibility" pattern as `ProfileTabs.tsx`/`AdminTabs.tsx` — the
bell itself never fetches anything on mount.

**Opening the panel immediately calls `/api/notifications/mark-read`**
(a thin wrapper around `marquer_notifications_lues()`), optimistically
zeroing the local badge count and reverting it only if the request
actually fails — there is no visual unread/read distinction *within* the
list itself (every row shown is either already read or about to become
read within the same click), only the bell's own badge distinguishes
"there's something new." This is what resolves an apparent tension in
the brief: it asks for "clic = marque comme lu + navigue," but Lot 6a
only specifies one RPC that marks *everything* read at once — the
answer is that the *panel opening itself* is the "clic" that marks
everything read; clicking an individual row inside the already-open panel
only ever navigates.

**`notificationHref()`** (`src/lib/notifications.ts`, pure, unit-tested)
maps each of the 12 types to where clicking it should go: `demande_recue`
→ `/offres` (the créateur has something to act on there); every other
transaction-related type → `/finance` (money/status context, whether
you're the fan or the créateur); `publication_aimee` → the permalink
`/@{pseudo}/p/{id}`. There is no per-transaction detail page in this
app, so "navigate to the transaction concerned" means the *page* where
that transaction is visible/actionable, not a literal `/transaction/[id]`
route that doesn't exist.

**`publication_aimee`'s permalink needs the *viewer's own* pseudo, not
the acteur's** — its `destinataire_id` is always the publication's own
auteur (migration 0034's own wiring guarantees this: a self-like never
notifies, so every `publication_aimee` row's destinataire really is
"whoever is reading their own notifications right now"). `(app)/layout.tsx`
already fetches the viewer's `pseudo` for the profile-link card, so
`getNotifications()` is called with it directly. Returns `href: null`
when the destinataire has no pseudo set at all — the permalink page
(`/[handle]/p/[id]`) 404s on a missing pseudo by design, and there's no
`/createur/[id]/p/[id]` fallback route, so a `null` href renders the row
as plain, non-clickable text rather than linking to something guaranteed
to 404.

**`getNotifications()` hydrates each row's `acteur` display name via
`profils_publics`** (batched, one query for every distinct `acteur_id`
across the page — same pattern `hydratePublications()` already
established), never a montant or any other transaction detail — this is
a lightweight recent-activity panel (`NOTIFICATIONS_PANEL_LIMIT = 20`),
not a full history page, per the brief's own "liste déroulante" framing
over "page dédiée."

Reserved-pseudo list is untouched by this lot — `/notifications` isn't a
route this app has (no dedicated page, only the dropdown), so nothing
needed adding there.

Verified visually end-to-end (same throwaway mock-Supabase/Playwright
technique used throughout this file, extended with `notifications`
table support and a couple of fixture rows): the badge shows the real
unread count and disappears once the panel is opened; each notification
type renders its correct message with the acteur's real display name
substituted in; clicking a `publication_aimee` row navigates to the
permalink and closes the panel; clicking a `/finance`-routed row
navigates there; and all of the above holds in both `fr` (light) and
`/en/` (dark).

## `accept_transaction`/`refuse_transaction`/`deliver_video` anonymous bypass — found and fixed (migration `0020`)

A real, currently-exploitable vulnerability, flagged during unrelated
work on `mes_progres_classement()` (migration `0019`, see below) after
noticing these three predated that function's `revoke all ... from
public` pattern — then **confirmed empirically before being trusted**,
the same discipline as the logo-click "logout" investigation: a
throwaway Postgres database was built from the real migrations, a real
pending `video` transaction was inserted belonging to a real créateur,
and `SET ROLE anon;` (no `app.current_user_id` at all — genuinely no
session) followed by `select accept_transaction('<that transaction's
id>')` **actually flipped it to `validee` and set `repondu_at`**. Same
result for `refuse_transaction` (→ `remboursee`) and, worse,
`deliver_video`: an anonymous caller could write an **attacker-chosen
r2_key** into `livrable`, which would then be served to the paying fan
as the créateur's real delivered video.

Two independent, compounding problems, both in every one of these three
functions since migration `0002`/`0006`/`0008`:

1. `if v_tx.createur_id != auth.uid() then raise 'not authorized'` — `!=`
   with a NULL operand evaluates to NULL, never `TRUE`, and PL/pgSQL's
   `IF` treats NULL the same as `FALSE`. So whenever `auth.uid()` was
   NULL (no session at all), this "authorization" check silently did
   nothing and execution fell straight through to the actual state
   change.
2. None of these three ever had `EXECUTE` revoked from `public`.
   Postgres grants `EXECUTE` to `PUBLIC` **by default** on newly created
   functions (unlike tables, which default to no access) — migration
   `0003`'s `grant execute ... to authenticated` was additive, never a
   replacement, and `anon` inherits `PUBLIC`. Confirmed directly:
   `select has_function_privilege('anon', 'accept_transaction(uuid)',
   'EXECUTE')` returned `true` before this migration.

**Fix, both layers, verified independently:**
- `revoke all on function ... from public` + re-grant to `authenticated`
  only, on all three functions — the same pattern already used for
  `mes_progres_classement()`. Verified directly: after this migration,
  `has_function_privilege('anon', ...)` is `false`, and the exact
  reproduction above now fails outright with `permission denied for
  function accept_transaction` (Postgres's own error, not this
  codebase's) — the transaction is left completely untouched
  (`statut` still `en_attente`).
- The ownership comparison itself changed from `!=` to `is distinct
  from` (correct regardless of which side is NULL) **and** an explicit
  `if auth.uid() is null then raise exception 'not authenticated'; end
  if;` was added at the very top of each function, before the `select
  ... for update` even runs — same style as `mes_progres_classement()`.
  This is deliberate defense in depth on top of the `EXECUTE` revoke,
  not redundant with it: it's what keeps this closed even if `EXECUTE`
  were ever mistakenly re-granted to `anon`/`public` again in the
  future, exactly the same "don't rely on a single layer" principle
  already applied to the pseudo-cooldown trigger and admin-escalation
  trigger elsewhere in this file.

**Tested at both layers in `checklist_2_3.sql`**, not just described:
`SET ROLE anon` against all three functions confirms a real
`insufficient_privilege` error (Postgres permission system, not
application logic); `SET ROLE authenticated` with no
`app.current_user_id` set at all confirms each function's own
`not authenticated` exception fires; and a final assertion confirms none
of the six rejected attack attempts left any trace on the targeted
transactions (`statut`/`livrable` unchanged). This is the same "always
extend the SQL checklist, never just describe new DB behavior in prose"
discipline this file has followed since the pseudo-cooldown bypass test.

**No application code needed to change** — `src/app/api/transactions/
[id]/accept/route.ts`, `.../refuse/route.ts`, and `.../deliver/route.ts`
already call these RPCs via the authenticated Supabase client and
already treat any RPC error as a failure to surface to the caller; a
genuine créateur accepting/refusing/delivering their own transaction was
never affected; only a caller with no session at all is newly rejected,
which was already the intended behavior everywhere else in this app.

## SECURITY DEFINER grant audit — same oversight checked everywhere else (migration `0021`)

Requested immediately after the `0020` finding, per the "an audit now
beats a similar discovery later" principle: every other `SECURITY
DEFINER` function in the project was checked for the same "`EXECUTE`
never revoked from `public`" oversight. Checked empirically for each one
(`has_function_privilege(...)` plus a live `SET ROLE anon` call against a
throwaway database), not assumed from reading the code.

**Two real, confirmed gaps**: `process_transaction_deadlines()` and
`close_expired_campagnes()` (the hourly deadline/campagne sweeps, meant
to run only from `/api/cron/check-deadlines` via the service-role
client) never had `EXECUTE` revoked/scoped at all, and neither has any
internal auth check — they're global sweeps by design, with no
per-caller scoping. `SET ROLE anon;` (no session at all) successfully
called both directly against a throwaway database: it refunded a real
overdue transaction via `process_transaction_deadlines()` and closed a
real expired campagne via `close_expired_campagnes()`. Unlike the `0020`
bug this can't target a specific victim's not-yet-overdue data, but it's
still a real hole — anyone on the internet could force either sweep to
run on demand instead of waiting for the trusted hourly cron. **Fixed**:
revoked from `public`, granted `EXECUTE` to `service_role` only — no
ordinary user, authenticated or not, has any legitimate reason to call
either directly, and the cron route already calls both via
`createSupabaseServiceRoleClient()`.

**Same missing-revoke oversight, but NOT actually exploitable**:
`set_admin_status()` and `mark_remboursement_manuel_traite()` (migration
`0015`). Both check `not exists (select 1 from users where id =
auth.uid() and est_admin = true)`. Unlike the `!=` bug, `id = auth.uid()`
with `auth.uid()` `NULL` matches zero rows — an equality against `NULL`
is simply never true for any real id, not an ambiguous comparison the
way `!=` was — so `not exists(...)` correctly evaluates to `true` and
`raise exception 'not authorized'` fires exactly as intended. Verified
directly: a live anonymous call against both (targeting a real user and
a real flagged transaction) was rejected with `not authorized`, and both
were left completely untouched. **Still tightened** for defense in depth
and consistency with every other admin RPC in this codebase: revoked
from `public`, granted to `authenticated` only (never `anon` — an admin
action always requires a real session) — matching how both admin API
routes already call them via the authenticated client, never
service-role.

**Also checked, confirmed not a gap at all**: `handle_new_auth_user()`
(the signup trigger) also never had `EXECUTE` revoked, but it's a
trigger function (`returns trigger`) — Postgres itself refuses to invoke
a trigger function directly regardless of any grant. Confirmed live:
`select handle_new_auth_user()` as `anon` fails with `trigger functions
can only be called as triggers`, a Postgres-level restriction this
codebase's grants don't control either way. Left as-is, matching every
other trigger-only function in this project (`enforce_pseudo_cooldown`,
`set_deadline_acceptation`, etc.), none of which revoke `EXECUTE` either
— there'd be nothing for the revoke to actually protect against.

Tested in `checklist_2_3.sql`: `SET ROLE anon` gets a real
`insufficient_privilege` error on all four RPCs; none of the four
rejected attack attempts left any trace (transaction/offre/user state
all confirmed unchanged); a positive check confirms `service_role` and
`authenticated` still hold `EXECUTE` on their respective functions
(the revoke didn't overreach); and `handle_new_auth_user()` is confirmed
uncallable directly with the exact Postgres error, not a generic one.

## Commission rate: 20% → 17%, frais/TVA absorbed by the platform (migration `0018`)

`create_paiement_on_validation()` now charges **17%** commission, down
from 20%, and `montant_net_createur` deducts **only** the commission —
`frais_agregateur` (CinetPay's own fee, still 3% of brut) and `tva`
(still 16% of the commission) are still computed and stored on every
`paiements` row for internal bookkeeping, but the platform now absorbs
both rather than passing them through to the créateur:
`montant_net_createur = montant_brut - commission_plateforme`, full
stop.

**This was a previously-requested change that had never actually been
implemented** — confirmed, not assumed, once it surfaced: it was found
while building the fundraising-campaigns feature (migration `0017`),
whose live payout calculator was specified assuming a
17%-commission/`objectif × 0,83`-net formula. That didn't match what
`create_paiement_on_validation()` actually charged at the time (still
20%, with `frais_agregateur`/`tva` both deducted from the créateur's
share too) — flagged rather than silently wiring the calculator to
either number, since the instruction was explicit that the calculator
must reuse the real formula, not a duplicated one. This section is the
follow-up: the rate itself is now actually 17%, so the calculator's
existing wiring (unchanged, see below) shows the right number without
needing any calculator-side fix.

`tva` is computed as 16% of the **new** 17%-based commission, not the
old 20%-based one — it's VAT on whatever the platform's real commission
revenue now is, not a historical figure.

Both the SQL formula (`create_paiement_on_validation()`, migration
`0018`) and its JS mirror (`calculerRepartitionPaiement()`,
`src/lib/transactions.ts` — `COMMISSION_PLATEFORME_TAUX = 0.17`) were
updated together, since the whole point of `calculerRepartitionPaiement`
existing is to never drift from the real DB formula. Verified with a
real transaction reaching `validee` against a throwaway database
(`checklist_2_3.sql`), not just read from the function's source: a
$100 transaction produces `commission_plateforme = 17`,
`frais_agregateur = 3` (unchanged), `tva = 2.72`, and
`montant_net_createur = 83` — proving both the new rate and that
`frais_agregateur`/`tva` are no longer subtracted from the créateur's
net. `transactions.test.ts` covers the same math for
`calculerRepartitionPaiement` directly.

`OffresManager.tsx`'s campaign live-calculator copy was updated to
match what the formula now actually does — "commission plateforme de
17% déduite — les frais de paiement et la TVA sont pris en charge par
la plateforme, pas déduits de ta part" — rather than the old wording,
which claimed frais/TVA were deducted (true before `0018`, false after).
Re-verified live with Playwright after this migration, exactly the same
way the pre-fix discrepancy was originally caught rather than assumed
fixed: typing `1000` into a campaign's objectif field now shows "environ
830$ net" (1000 × 0.83 exactly), and `83` shows "environ 68.89$ net"
(83 × 0.83 exactly) — both recomputed on every keystroke, with no
changes needed to the campaign feature's own code since it was already
calling the shared formula rather than a duplicated one.

## Commission rate: 17% (absorbed) → 15% HT + TVA répercutée (migration `0024`)

Reverses migration `0018`'s "platform absorbs `tva`" decision, switching
to the standard marketplace-intermediation model: the platform's
commission is now a **15% HT (hors-taxes) rate**, `tva` (still 16% of the
commission, unchanged formula) is added on top of it, and that HT+TVA
total is what the créateur actually pays — so `tva` is deducted from
their share again, not absorbed by the platform.
`frais_agregateur` (CinetPay's own fee) is **untouched by this
migration** — still 3% of brut, still absorbed by the platform, never
passed through to the créateur; only the `tva` treatment changes here.

`create_paiement_on_validation()`:
`v_commission := round(new.montant * 0.15, 2)` (down from 0.17),
`v_tva := round(v_commission * 0.16, 2)` (same formula, now on the new
15% base), and — the real mechanical change, not just the rate —
`montant_net_createur := new.montant - v_commission - v_tva` instead of
`new.montant - v_commission` alone.

Both the SQL formula (migration `0024`) and its JS mirror
(`calculerRepartitionPaiement()`, `src/lib/transactions.ts` —
`COMMISSION_PLATEFORME_TAUX = 0.15`, `montantNetCreateur = round2(montant
- commissionPlateforme - tva)`) were updated together, same "never drift
from the real DB formula" discipline as `0018`. Verified with a real
transaction reaching `validee` against a throwaway database
(`checklist_2_3.sql`): a $100 transaction now produces
`commission_plateforme = 15`, `frais_agregateur = 3` (unchanged),
`tva = 2.4`, and `montant_net_createur = 82.6` (100 − 15 − 2.4) —
proving both the new rate and that `tva` is deducted from the créateur's
net again while `frais_agregateur` still isn't. `transactions.test.ts`
covers the same math for `calculerRepartitionPaiement` directly.

`OffresManager.tsx`'s campaign live-calculator copy (`OffresManager.
liveCalculatorText` in `messages/{fr,en}.json`) was updated to match:
"commission plateforme de 15% + TVA (16%) déduites — les frais de
paiement restent pris en charge par la plateforme" — dropping the old
claim that TVA was absorbed by the platform (true under `0018`, false
now), without spelling out the HT/TTC mechanics in the UI itself (too
technical for a créateur-facing screen) — just being honest that TVA is
now part of what's deducted. No calculator-side code change was needed
beyond the copy: `CampagneRow` already calls the shared
`calculerRepartitionPaiement()` rather than a duplicated calculation, so
once the underlying formula changed, the displayed net amount updated
automatically.

Out of scope for this migration, unchanged: `frais_agregateur` (still 3%,
still absorbed), the `modele_rentabilite_plateforme.xlsx` spreadsheet
(maintained separately, not by Claude Code), and the IS 30%/prélèvement
14% question (still a separate, not-yet-addressed topic).

## Fundraising campaigns (offre type `campagne`, migration `0017`)

A créateur can run one or more time-limited fundraising campaigns
("Toit pour l'église", "Frais de studio"...), each with a title, a
description of the cause, a target amount, and an optional end date.
Mechanically it's `don` (free-amount, immediate validation) plus a
title, a goal, and two auto-close conditions layered on top — nothing
about the underlying payment flow is new.

**Schema**: `type = 'campagne'` reuses `video`'s existing "several rows
per créateur, distinguished by `libelle`" mechanism
(`unique_offre_type_par_createur`, `NULLS NOT DISTINCT`, migration
`0007`) verbatim — `libelle` holds the campaign's title, no constraint
changes were needed for this part at all. `prix` stays null, exempted
from `offres_prix_required_unless_don` alongside `don` — the fan picks
the contribution amount at payment time, identical to a plain don.
`config` holds `{description, objectif, date_fin}` — `date_fin` is
optional/nullable, stored as a plain `"YYYY-MM-DD"` string (same
convention as `date_naissance`, no time-of-day component). Validated at
the application layer (`creerOffreSchema` in `src/lib/validation.ts`):
`libelle` (title) and `config.description`/`config.objectif` (a finite,
positive number) are required for this type, `config.date_fin` — when
present — must match `^\d{4}-\d{2}-\d{2}$`.

**Montant collecté is never stored, always computed live** — the
`campagnes_montant_collecte` view (`offre_id, montant_collecte`) sums
`transactions.montant` for `statut = 'livree'` rows per campagne offre,
`LEFT JOIN`ed so a brand-new campaign with zero contributions still
gets a `0` row instead of being absent from the view. Same "aggregate
only, never raw transaction rows" discipline as the `classement_*`
views — this view can't be used to learn who donated or how much any
single fan gave, only the total. Granted to `authenticated`/`anon` like
every other public view in this project.

**`campagnes_publiques` deliberately does not filter on `actif = true`**
— unlike `offres_publiques`, which still does, even for `campagne` rows.
This is the one thing that makes campaigns behave differently from
every other offer type: a closed campaign (goal reached, or its
`date_fin` passed) must stay visible on the public profile as history,
never disappear the moment it stops accepting contributions. `config` is
included in this view too (unlike `offres_publiques`, which excludes it
for every type since `evenement_live`'s config holds a secret
pre-payment link) — none of `campagne`'s config keys are sensitive, the
description/objectif/date_fin are meant to be fully public.

**Two independent auto-close paths, both verified with real inserts
against a throwaway database before trusting them, exactly like the
pseudo-cooldown/admin-escalation triggers**:
1. **Goal reached** — `close_campagne_if_goal_reached()`, an `AFTER
   UPDATE ON transactions` trigger firing in the same "transitioned into
   `livree`" moment `create_paiement_on_validation()`/
   `handle_transaction_livraison()` already do. It sums delivered
   contributions for the campagne (via the same same-transaction
   read-your-own-write Postgres guarantees those other triggers rely on
   — the contribution that just landed is already included) and sets
   `actif = false` the instant the total reaches or exceeds `objectif`.
   `config->>'objectif'` is parsed inside an exception handler rather
   than a bare `::numeric` cast — `config` is untyped client-supplied
   JSON, and a malformed value here must never be able to break an
   unrelated fan's payment webhook call, same "a side effect must never
   break the primary flow" principle as `processAutomaticRefund()`.
2. **`date_fin` passed without reaching the goal** — nothing else
   naturally happens on a campaign's end date, so this can't be
   event-triggered; `close_expired_campagnes()` rides the same hourly
   external-cron infrastructure `process_transaction_deadlines()` already
   uses (see "Transaction lifecycle" above), called as a second RPC from
   `/api/cron/check-deadlines`. `< current_date` (strictly less than) —
   not `<=` — means a campaign stays open through the entirety of its
   `date_fin` day, closing starting the day after. The
   `config->>'date_fin' ~ '^\d{4}-\d{2}-\d{2}$'` guard exists for the
   same reason as the exception handler above: this is a single batch
   `UPDATE` across every créateur's campaigns, and one malformed
   `date_fin` must never be able to abort the whole statement and block
   every other créateur's legitimately-expired campaign from closing.

Both paths verified with real insertion/update sequences in
`checklist_2_3.sql`, not assumed to work as written: a campaign stays
active below its goal, auto-closes the instant a contribution reaches
it, stays visible in `campagnes_publiques` afterward while disappearing
from `offres_publiques` (proving the two views' different filtering is
intentional, not an oversight), and `close_expired_campagnes()` closes
only a campaign whose `date_fin` has strictly passed — a campaign whose
`date_fin` is still *today* is confirmed to remain untouched (the
boundary case that would be easy to get off-by-one on).

**Status is computed, never stored** — `computeCampagneStatus()`
(`src/lib/campagnes.ts`) is the single source of truth for the
active/objectif_atteint/terminee three-way badge, shared by the public
profile (`CreateurProfileView`) and the créateur dashboard
(`OffresManager`'s `CampagneRow`) so the two can never disagree.
`objectif_atteint` is checked independently of the `actif` column (not
"inferred from actif being false") so the badge is still correct in the
brief window before the auto-close trigger has actually run; `terminee`
covers both `date_fin` having passed **and** any other reason the
campaign is inactive (e.g. manually paused via the existing
désactiver/réactiver toggle every offer type already has) — from a
fan's perspective both read the same: this campaign isn't accepting
contributions right now. Same file also exports
`computeCampagneProgressPercent` (clamped 0–100) and
`computeJoursRestants` (inclusive of `date_fin`'s own day, consistent
with the DB's `< current_date` closing rule) — all three are pure and
unit-tested (`campagnes.test.ts`) without needing a browser or a real
database.

**The créateur-facing live payout calculator does not duplicate the
commission formula.** `CampagneRow`'s live calculator
(`src/components/OffresManager.tsx`) calls
`calculerRepartitionPaiement()` (`src/lib/transactions.ts`) — the same
JS mirror of the SQL formula this codebase already had — and shows its
real `montantNetCreateur`, rather than an independent calculation that
could drift if the rates ever change. This is what made the commission
rate fix (20% → 17%, migration `0018`, see "Commission rate" above)
require **no calculator-side change at all**: the calculator was already
wired to the real formula when it was originally built (against the
then-current 20% rate, which didn't match the feature request's
17%/`0,83` phrasing — flagged rather than silently using either number
at the time), so once the underlying rate actually became 17%, the
calculator started showing the right number automatically. Confirmed,
not assumed, after the rate change: typing `1000` into a campaign's
objectif field now shows "environ 830$ net" (1000 × 0.83 exactly), and
`83` shows "environ 68.89$ net" (83 × 0.83 exactly).

**Donating to a campaign reuses the existing free-amount don flow
verbatim** — `CheckoutButton` and `/api/transactions/initiate` both
already special-cased `type === "don"` for a fan-chosen amount; both now
check `type === "don" || type === "campagne"` instead of adding a
second, parallel code path. The webhook (`TYPES_A_VALIDATION_IMMEDIATE`)
gained `campagne` alongside `don`/`contenu_debloque`/`evenement_live`
(payment success is delivery, no acceptation step) — and its
prix-match check (`Math.abs(amount - Number(offre.prix)) > 0.01`), which
already exempted `don`, now exempts `campagne` too: since `campagne`'s
`prix` column is always null, `Number(null)` is `0`, and without this
exemption every real contribution would have been rejected as
"montant payé ne correspond pas au prix de l'offre". Caught before ever
reaching a real webhook call, by re-reading the existing `don` exemption
line and asking what it would do for a type with the same null-`prix`
shape.

**Public profile card layout** (adjusted after an initial round of
feedback): the section heading is `t("campagnes.heading")` —
"Campagnes de collecte de fonds" / "Fundraising campaigns" — not the
bare "Campagnes" it originally shipped with, which read as ambiguous
(an electoral or vaccination campaign, not a fundraiser). Each card in
`CreateurProfileView` follows a fixed, deliberate order: (1) title +
status badge, (2) progress bar + montant collecté + percentage
together (`t("campagnes.collecteEtPourcentage")`), (3) objectif +
description of the cause (`t("campagnes.objectifLabel")`) + jours
restants, (4) the amount field + "Payer" button (`CheckoutButton`) —
show what it is, then the momentum already behind it, then the full
context, then the ask. The progress track itself carries `border
border-border` on top of its `bg-surface-muted` fill — at `--surface:
#ffffff` vs `--surface-muted: #f6f1ff` (light mode) the two are only
~2% apart in lightness, so a 0%-filled bar was previously all but
invisible against the card; the border makes the track legible from
the very first dollar, not just once it starts filling in. Campaign
amounts (`objectif`, `montantCollecte`) are formatted with
`formatMontant()` (`src/lib/campagnes.ts`, wraps
`Intl.NumberFormat`, defaults to `"fr-FR"` grouping) — a raw `12500$`
is hard to scan for a 4-5 digit goal; the public profile passes
next-intl's own `useLocale()` so an English-locale visitor sees
`12,500` grouping instead of `12 500`. Verified against Node's actual
`Intl` output rather than assumed, since fr-FR's grouping separator is
a narrow no-break space (U+202F), not a plain space — a naive test
string would have silently never matched.

Each campaign card carries a stable `id="campagne-{id}"` anchor
(`scroll-mt-6` for defense against any future sticky header, though
there isn't one today) — confirmed this anchor did **not** already
exist anywhere before adding it (there was no id-based deep-linking
into a specific card at all), so `ShareCampagneButton.tsx` was added
alongside it in the same change rather than assuming a pre-existing
hook. It builds `${origin}${pathname}#campagne-{id}` and hands it to
`navigator.share()` where available (mobile), falling back to
`navigator.clipboard.writeText()` with a 2s "Lien copié !" confirmation
on desktop. Verified live with Playwright, not just read from the
code: clicking the button copies exactly
`http://.../createur/creator-1#campagne-campagne-active` to the
clipboard, and separately, loading `/createur/creator-1#campagne-...`
directly (simulating a visitor opening a shared link) auto-scrolls the
browser straight to that card via the browser's native anchor
handling — no custom scroll code needed, the `id` alone is sufficient.

**Créateur dashboard**: `CampagnesList`/`CampagneRow` in
`OffresManager.tsx` mirror `VideoOffresList`/`VideoOffreRow`'s
repeatable-row pattern (a créateur can launch more than one campaign
over time, not a single settings row) — the form doubles as both
creation and history: an existing campaign shows its title, status
badge, progress bar, and collected/objectif figures inline above its
(pre-filled, still-editable) form fields. `montantCollecte` is threaded
through from the dashboard page's own query against
`campagnes_montant_collecte` (the same view the public profile reads,
so the dashboard's numbers can never disagree with what a fan sees) as
an extra optional field on the `Offre` type passed into `OffresManager`,
meaningful only for `campagne` rows.

## CinetPay webhook (`src/app/api/webhooks/cinetpay/route.ts`)

- Verifies the `x-token` header via real HMAC-SHA256
  (`src/lib/cinetpay.ts`), fields concatenated in CinetPay's documented
  order, keyed with `CINETPAY_SECRET_KEY`. **Fails closed**
  unconditionally: missing header, missing/unset secret, or a mismatch
  all reject with 403 — there is no "trust it in dev" path, ever.
- Explicitly joins `offres` for the type before any conditional logic;
  `if (!offerType) throw` rather than letting `undefined` fall through to
  a default branch.
- Idempotent: `transactionId` doubles as the transaction's primary key
  (generated client-side at `/api/transactions/initiate` and round-tripped
  through CinetPay's `cpm_trans_id`/`cpm_custom`), so a resent webhook
  no-ops via a pre-insert existence check.
- No transaction row exists before payment succeeds — `initiate` never
  writes to the DB, only calls CinetPay's init API and passes
  `{fanId, offreId}` through `cpm_custom` for the webhook to reconstruct.

## Automatic CinetPay refunds (migration `0014`)

**A real, dangerous gap, found by actually reading the code rather than
assuming**: marking a transaction `remboursee` (the deadline cron,
`refuse_transaction`) has only ever changed our own bookkeeping —
`paiements.statut_paiement = 'rembourse'` — via a plain SQL `UPDATE`.
Confirmed by reading `process_transaction_deadlines()`,
`handle_transaction_remboursement()`, and `refuse_transaction()` in full,
and by grepping the entire `src/` tree for `refund`/`cinetpay.com`: the
only outbound CinetPay call anywhere in this codebase is
`initiateCinetPayPayment()` (checkout initialization). No refund/reversal
call exists. No HTTP extension (`pg_net`, `http`) is even installed in
Postgres — only `pgcrypto` — so the database layer has no technical way to
make one either. **A fan whose transaction gets auto-refunded today does
not get their money back.**

**CinetPay's refund API documentation could not be found publicly** —
flagged rather than guessed at, per explicit instruction. Checked:
`docs.cinetpay.com`'s checkout/notification/verification/transfert pages
(via web search, since the domain itself is blocked by this sandbox's
network policy), CinetPay's public SDK repositories, and general search
for "CinetPay remboursement/refund/reversal API". The only outbound
money-movement product found documented is **Transfert** (a generic
payout API, separate from Checkout) — but it requires the recipient's
phone number to first be manually added as a contact and confirmed via an
emailed link before any transfer can be sent, which is structurally
incompatible with an unattended automatic refund, and was never confirmed
to even apply to reversing a specific checkout transaction (no
original-transaction reference field, no refund-specific fee contract
documented). Guessing a plausible-looking request shape would be worse
than not implementing this at all.

**What's built instead — real infrastructure, stubbed API call**:
- `transactions` gained four columns (not `paiements` — a `paiements` row
  only exists once a transaction reaches `validee`
  (`create_paiement_on_validation()`), but the acceptation-deadline
  refund path fires while a transaction is still `en_attente`, before any
  `paiements` row exists; `transactions` always exists at refund time,
  for both refund paths): `reference_remboursement_cinetpay` (null until
  a real refund is confirmed — this is the idempotency key),
  `remboursement_tentative_a` (timestamp set *before* the outbound call,
  not after — so a request that times out on our side but may have
  succeeded on CinetPay's is remembered as "attempted"),
  `montant_rembourse` (the actual refunded amount, once known), and
  `necessite_remboursement_manuel boolean not null default false`.
- `handle_transaction_remboursement()` (the trigger) now **always** sets
  `necessite_remboursement_manuel = true` the moment a transaction becomes
  `remboursee`, regardless of the feature flag below. This is the safe
  default: the real CinetPay call can only ever happen from application
  code (no HTTP extension), so the DB layer cannot itself attempt or
  confirm a refund — it can only flag intent. Whatever clears the flag
  does so from `src/lib/refunds.ts`, and only after a *confirmed* success.
  If nothing ever clears it — flag off, the call fails, or a future
  contributor forgets to wire something in — it just stays `true` forever,
  which is the point: nothing is silently lost track of. (The trigger's
  self-referential `UPDATE transactions ... WHERE id = new.id` from
  within its own `AFTER UPDATE ON transactions` trigger is safe, not an
  infinite loop — it re-fires the trigger once more, but by then
  `old.statut = new.statut = 'remboursee'` already, so the `IF` condition
  is false and it stops.)
- `parametres_plateforme` gained two entries, same pattern as the
  existing flags: `remboursement_cinetpay_actif` (boolean, **defaults
  false** — the master switch; never flip this on before
  `refundCinetPayPayment()` below is implemented against a contract
  confirmed directly with CinetPay and tested against a real sandbox
  account) and `remboursement_pourcentage` (number 0–100, **defaults
  100**) — the percentage of the original amount to refund, configurable
  rather than hardcoded because whether a CinetPay refund returns the
  fan's full payment or the amount net of CinetPay's own commission isn't
  confirmed yet; adjust this key once that's known, no redeploy needed.
- `src/lib/cinetpay.ts#refundCinetPayPayment()` is a **documented stub
  that always throws** — see its doc comment for the full account of what
  was searched. This is deliberate and is itself covered by a regression
  test (`cinetpay.test.ts`) asserting it still throws, specifically so
  nobody "fixes" it into a fake success without first replacing it with a
  real, confirmed call.
- `src/lib/refunds.ts#processAutomaticRefund(supabase, transactionId)` is
  the orchestrator, called right after both refund paths
  (`/api/cron/check-deadlines` for the deadline sweep,
  `/api/transactions/[id]/refuse` for a créateur's manual refusal — the
  latter via the **service-role** client, since `transactions` has no
  authenticated-user UPDATE policy at all; `refuse_transaction()` already
  re-verified `createur_id = auth.uid()` before this point, so this isn't
  bypassing that check, just writing follow-up columns RLS wouldn't allow
  the créateur to touch directly). It never throws — a CinetPay failure
  must never turn an otherwise-successful cron run or refusal into a
  user-facing error; `necessite_remboursement_manuel` staying `true` is
  the correct outcome of any failure, not something to retry blindly. Full
  idempotency chain, checked in order before ever calling
  `refundCinetPayPayment()`: (1) transaction not `remboursee` → no-op;
  (2) `reference_remboursement_cinetpay` already set → already confirmed,
  no-op; (3) feature flag off → no-op (the trigger's marker already
  covers it); (4) `remboursement_tentative_a` already set → a previous
  attempt exists with no confirmed outcome — genuinely ambiguous (real
  failure vs. a timeout that actually succeeded on CinetPay's side), and
  since no confirmed "check refund status" endpoint exists either to
  disambiguate, the only safe move is to **never blindly retry** and leave
  it on the manual worklist. Only once all four checks pass does it record
  the attempt timestamp, compute the amount via
  `computeRefundAmount(montant, pourcentage)`, and call the (stubbed)
  refund function.
- Tested at every layer: `refunds.test.ts` (idempotency in all four
  directions above, percentage calculation, that a failure never throws
  out of `processAutomaticRefund`), `cinetpay.test.ts` (the stub always
  throws), route tests for both call sites (refund attempted exactly when
  expected, never on an auth/RPC failure), and the SQL checklist (the
  trigger always sets `necessite_remboursement_manuel` for both refund
  paths, and the two `parametres_plateforme` defaults are correct).

**Before flipping `remboursement_cinetpay_actif` on**: implement
`refundCinetPayPayment()` against a contract confirmed directly with
CinetPay (exact endpoint, authentication, and the refund-fee/percentage
question above), test it against a real CinetPay sandbox account, then
flip the flag — no redeploy needed for the flag itself, only for the
real implementation replacing the stub.

## Admin dashboard (`/admin`, migration `0015`)

Business-only page, gated by `users.est_admin` — see the schema entry
above for the DB-level (not just application-level) guarantee that a
normal user can never grant this to themselves.

**404, never a redirect, for a non-admin visitor** — logged out or
logged in but not admin, both get the exact same real Next.js 404
(`notFound()` from `next/navigation`, not the locale-aware `redirect()`
every other protected page uses). A redirect to `/login` would itself
leak that this route exists and is auth-gated; a 404 looks identical to
a URL that was never a route at all. Verified empirically with
Playwright against the mock Supabase server: a non-admin visit returns
real HTTP 404 with Next's generic "This page could not be found" body,
the URL stays `/admin` (no bounce to `/login`), and none of the
admin-only queries below ever fire (confirmed via a spy on the
service-role client) — only once the same session is flipped to admin
does the page render.

**Bootstrapping the first admin**: since nobody starts out admin,
`set_admin_status()` (below) can never be used to create the very first
one — there'd be no existing admin to authorize the call. This is
intentional, not an oversight: `enforce_est_admin_change` exempts any
UPDATE where `auth.uid()` is null (a direct SQL Editor session, a
migration, or a service-role connection — none of which carry a
PostgREST JWT), so the first admin is bootstrapped with a single plain
`update users set est_admin = true where id = '<uuid>';` run directly
against the database, once, outside the app. Every subsequent
grant/revoke goes through the app normally. There's no
"last admin" guard against a sole admin revoking their own status —
flagged rather than silently protected against, since fixing a
self-lockout still only takes the same one-line direct `UPDATE`.

**Granting/revoking someone else's status** needs a `SECURITY DEFINER`
RPC (`set_admin_status(p_user_id, p_est_admin)`), not a raw table write —
`users_update_self`'s RLS is `id = auth.uid()`, so even a genuine admin
cannot `UPDATE` another user's row directly via PostgREST at all. The RPC
re-verifies the caller is already admin before writing (defense in
depth alongside the trigger, same pattern as
`accept_transaction`/`refuse_transaction` re-verifying ownership despite
already being `SECURITY DEFINER`) and raises `not authorized` rather
than silently no-op'ing, so `/api/admin/set-admin-status` can surface a
real 403 instead of a confusing "nothing happened."

**Manual-refund worklist** reads `transactions` where
`necessite_remboursement_manuel = true` (see "Automatic CinetPay
refunds" above), oldest first — it's an operational queue, not a feed,
so the longest-overdue one surfaces first. "Marquer comme traité"
(`mark_remboursement_manuel_traite()`, same `SECURITY DEFINER` +
re-verify-admin pattern) clears only that flag. It deliberately never
touches `reference_remboursement_cinetpay`/`montant_rembourse` — those
columns specifically mean "a real automated CinetPay API call was
confirmed," which a manual dashboard refund isn't; setting them here
would misrepresent what actually happened. Verified in
`checklist_2_3.sql` that both stay `null` after marking a manual refund
treated.

**Vue d'ensemble / top créateurs** both use one consistent, deliberately
unadjusted definition of "this month's activity": every transaction
`created_at` this calendar month, **all statuses included** (refused/
refunded transactions count too) — "GMV brut" means gross, not
net-of-refunds. Both admin-page queries and the "gestion des admins"
user list run via the **service-role** client, only after the page's own
`est_admin` check (via the normal, RLS-scoped client) already
re-verified this exact caller server-side — same "verify with the real
client first, then use service-role for the privileged read" pattern as
the whatsapp-link/content-url delivery routes. `users` has no email
column at all (deliberately — see the schema section) — emails for the
"gestion des admins" list come from `supabase.auth.admin.listUsers()`
(the Auth Admin API, only reachable with the service-role key), joined
to `public.users` by id.

**A real bug found and fixed by actually driving this in a browser, not
just unit tests**: after a successful "Marquer comme traité" or
grant/revoke click, `router.refresh()` re-fetches the server data but
does **not** remount the client component — if the same row is still
present afterward (the créateur stays in the admin list after a toggle;
in the mock-server visual test the same manual-refund row stayed too,
since the mock doesn't mutate its fixtures), the button's `pendingId`
state stayed stuck showing its loading label forever. Fixed by clearing
`pendingId` back to `null` on success, not just on error, in both
`RemboursementsManuelsManager` and `GestionAdminsManager`.

## Créateur verification (`demandes_verification`, migration `0023`)

Two-tier, non-monetary trust signal: a "✓ Vérifié" badge, opt-in only in
the sense that a créateur has to actively request it — there's no
"public until you hide it" direction here at all, unlike
`classement_public`/`badge_fidelite_public`.

### Palier 1 — free, self-serve, works today

`users.createur_verifie boolean default false` gates the badge, rendered
via the shared `VerifiedBadge` component on `CreateurProfileView`
(header, `tone="onDark"` since it sits on the brand-gradient banner —
the default brand-tinted style would be nearly invisible there, same
reasoning as the header's social-link chips) and `/explorer`'s cards
(`tone="light"`, the default). **Set exclusively by
`approuver_verification()`** — never by requesting, never by anything
else; this is asserted directly in `checklist_2_3.sql`, not just assumed
from reading the trigger-free column.

A créateur requests verification from `/parametres` (`VerificationForm.tsx`,
its own independent card, same "each concern saves on its own" principle
as the pseudo/bio blocks on that page): pick a platform (TikTok/Instagram/
YouTube), give a profile link, and `creer_demande_verification()` — a
`SECURITY DEFINER` RPC, **not** a plain client-side INSERT — atomically
generates a random `FanBoss-XXXXXXXXXX` code, runs the conflict check
below, and inserts the row with the correct initial `statut` in one
transaction. This can't be a plain INSERT because the conflict check
needs to read *other* créateurs' `nom_affichage` and their own pending/
approved requests, which `demandes_verification_select_own`'s RLS would
otherwise block a plain authenticated caller from seeing — there is
deliberately no INSERT/UPDATE policy on this table for authenticated
users at all, exactly the same "state machine only via a vetted RPC"
shape already used for `transactions`. **The code is generated once and
never regenerated** — `/parametres` always reads back the stored row
(`code_verification`), so reloading the page shows the same code, per
explicit instruction.

**Conflict detection** compares *live* `nom_affichage`, normalized
(`normaliser_nom_affichage()`: lowercase, accents stripped via Postgres's
`unaccent` extension, whitespace collapsed), across every *other*
créateur who already has a request in `en_attente` or `approuve`. A
match inserts the new request directly as `conflit` **and** flips any of
the matched créateur's own still-`en_attente` requests to `conflit` too
— an already-`approuve` request is deliberately left alone by this
automated step; silently un-verifying someone based on a same-name
collision with a brand-new signup would be exactly the kind of
unreviewed automated decision palier 2 (below) exists to avoid.
**Deliberately compares the live `users.nom_affichage` via a join, not a
snapshotted column on `demandes_verification`** — same "never store what
a live query already gives you" principle as
`campagnes_montant_collecte` and `badges_fidelite_publics.depuis`; a
créateur's claimed identity is whatever their current public display
name is, not a frozen copy that could quietly drift from it.

`/admin`'s "Vérifications" section (`VerificationsManager.tsx`) shows two
separate lists — "En attente" and "Conflits" (the latter with a visibly
distinct red border plus the KYC notice, see below) — each row showing
the créateur's label, platform, a clickable link to the claimed account,
the expected code, and Approuver/Refuser buttons. Approving a `conflit`
row is deliberately still allowed through the same button: a human admin
actually looking into both accounts *is* the "manual resolution" palier
2 is waiting for (see below) — there is no separate, gated "resolve
conflict" action, and approving one side never auto-touches the other.

### Palier 2 — conflict escalation: structure only, deliberately not built further

**No automated video/selfie verification was built, per explicit
product decision, and none should be added later without discussing it
first.** The instruction that shaped this feature was explicit that
DIY video-based liveness checks (record yourself saying a code) are no
longer considered a reliable defense against 2026-era deepfake/injection
attacks against webcam and upload pipelines — this codebase takes that
as a given product/security decision, not something independently
re-verified via research here (unlike the CinetPay refund investigation
below, which *did* involve an actual documentation search). No upload
flow, no liveness-check UI, no "say this code out loud" prompt exists
anywhere in this codebase, and none should be added as a stand-in for
real KYC.

**What happens instead, and why nothing automated calls out to a KYC
provider**: exactly the same situation as `refundCinetPayPayment()`
(migration `0014`, see "Automatic CinetPay refunds" above) —
**no third-party KYC provider is integrated, and no credentials for one
exist in this project.** Rather than fabricate a call to a nonexistent
API or silently no-op, a `conflit` row simply sits in `/admin`'s
"Conflits" list, permanently, with the message: *"Ce cas nécessite une
vérification d'identité par un prestataire tiers (KYC) — aucun badge ne
doit être accordé à aucun des comptes en conflit tant que ce n'est pas
résolu manuellement."* There is no stub function analogous to
`refundCinetPayPayment()` here, and deliberately so: unlike the refund
flow (which already has a real code path that *attempts* the call and
needs something to throw in its place), nothing in this feature ever
tries to reach a KYC vendor at all — there's no call site to stub. The
entire "integration" is: flag it clearly, then wait for a human.

**Before wiring in a real KYC provider**: confirm a provider, get real
credentials, and only then add an actual API call — following the exact
same discipline as the CinetPay refund stub (never fabricate a
confirmation, never simulate success for a call that doesn't really
happen). A future session finding a `conflit` row that's been sitting
for a while is not a bug to "fix" by quietly approving it or by writing
a fake automated resolution — that row is doing exactly what it's
supposed to do until someone with real KYC tooling looks at it.

### Testing

Tested end-to-end in `checklist_2_3.sql` with a real scenario, not
described in prose: two créateurs with normalized-equal display names
(different case/accents/whitespace) — the second request lands as
`conflit` immediately, and the first créateur's still-pending request
flips to `conflit` too, while a third, genuinely-different créateur's
own request is left untouched throughout. `createur_verifie` is
confirmed `false` for both sides of the conflict until an admin actually
approves one, and approving one side is confirmed to never auto-verify
or otherwise touch the other side (still `conflit`, `createur_verifie`
still `false`). `profils_publics` is checked directly to confirm the
badge is exposed only for the approved créateur. Security follows the
migration `0020`/`0021` pattern throughout, verified the same way (`SET
ROLE anon`/`SET ROLE authenticated`): `anon` has no `EXECUTE` at all on
any of the three new functions, `creer_demande_verification()` rejects a
`NULL auth.uid()`, and `approuver_verification()`/`refuser_verification()`
reject a genuinely-authenticated non-admin caller.

Verified visually end-to-end (same throwaway mock-Supabase technique
used throughout this file): submitting a request on `/parametres` shows
the generated code immediately and the exact same code again after a
page reload (never regenerated); the créateur's own public profile and
their `/explorer` card show no badge at all before approval; `/admin`
renders both lists populated, with the conflict rows visibly
red-bordered and carrying the KYC notice; approving a request removes it
from "En attente" and makes the badge appear immediately on both the
public profile (banner, white/translucent style) and the `/explorer`
card (brand-tinted style); and refusing one side of a conflict removes
only that row, leaving the other conflicting créateur's row untouched in
the "Conflits" list.

**Unrelated pre-existing bug noticed and fixed while visually verifying
`/explorer` here**: the filter dropdown iterates every `OFFRE_TYPES`
value including `campagne` (added in migration `0017`), but
`CreateurProfile.offerTypes` in the message files never got a `campagne`
key added at the time — every `/explorer` render threw a
`next-intl` `MISSING_MESSAGE` error (visible in the dev overlay and
server console) the whole time since `0017` shipped, unrelated to
créateur verification. Fixed by adding the missing key to both `fr`/`en`
message files.

## Video/content delivery (brief 0.5)

R2 bucket is private, no public URL configured anywhere.
`src/lib/r2.ts`'s `getSignedDownloadUrl`/`getSignedUploadUrl` are the only
way in or out. Standard expiry is 1h for video/whatsapp-adjacent content;
profile photos use a longer 24h expiry (not sensitive, but still signed
rather than public, for consistency — a fresh URL is minted server-side
on every profile page render, so staleness isn't a real concern). Every
delivery route re-verifies `fan_id = auth.uid() AND statut = 'livree'`
(or, for `contenu_debloque`/`evenement_live`, the equivalent ownership
check reading `offre.config` via service-role) before minting a URL.

## Profile photo crop (`PhotoCropper.tsx`, `src/lib/imageCrop.ts`)

Every profile photo goes through a client-side, Instagram-style square
crop **before** it's ever uploaded — selecting a file in `/parametres`
opens `PhotoCropper` (pan by dragging, zoom via a range slider, rotate in
90° steps, all built on a plain `<canvas>`, no cropping library) instead
of uploading the raw file directly. Confirming re-encodes the visible
square onto an off-screen `CROP_EXPORT_SIZE` (800×800) canvas and exports
it with `canvas.toBlob(..., "image/jpeg", 0.9)` — this is what makes the
upload always a small, consistent JPEG regardless of the source file's
format (HEIC, PNG...) or dimensions, since the browser's own canvas
decode/re-encode pipeline handles the conversion uniformly. `ParametresForm`
never touches the original `File` after that; `file` state only ever
holds the cropped result, wrapped via `new File([blob], "profil.jpg", {
type: "image/jpeg" })`.

The crop geometry (`computeDrawGeometry`, `clampOffsetFrac`,
`drawCropToCanvas` in `src/lib/imageCrop.ts`) is deliberately DOM-free and
resolution-independent — pan is stored as a fraction of canvas size, not
raw pixels — so the exact same functions draw both the small interactive
preview and the final 800×800 export with no risk of the two drifting
apart, and the math is unit-testable without a real `<canvas>`
(`imageCrop.test.ts`). Panning is clamped so the (possibly rotated) image
always fully covers the square; the transform order is pan-in-screen-
space-*then*-rotate specifically so dragging "right" always moves the
image right on screen even after a 90°/270° rotation, not along the
image's own rotated axis.

**Real bug found and fixed here by actually driving the component in a
browser, not just from reading the code**: the image-loading `useEffect`
originally had no cancellation guard, so under React Strict Mode's
dev-mode double-invoke (mount → cleanup → mount again), the *first*
`Image`'s `onerror` could fire after its own `objectUrl` was already
revoked by that first cleanup — showing a false "format not supported"
error even though the second, real load succeeded. Fixed with a
`cancelled` flag captured in the effect's closure, checked at the top of
both `onload` and `onerror`.

**Mobile upload bug**: the PUT straight to the presigned R2 URL in
`ParametresForm`'s main submit never checked `response.ok` — a failed
upload (bad network, an R2/signature rejection) silently fell through and
still wrote a `photo_r2_key` pointing at nothing, appearing later as "the
photo just doesn't show up" with no error anywhere. Now checked, throwing
an error with the HTTP status and (truncated) response body through the
same `useSaveStatus` error path as everything else. The prime suspect for
why this specifically hit mobile: `getSignedUploadUrl` (`src/lib/r2.ts`)
signs the presigned URL with a specific `ContentType`, which the actual
PUT must match exactly or R2 rejects it — before this change, that
`ContentType` was whatever `file.type` happened to be for the raw
picked file, which for a phone camera photo can be empty or unusual.
Since every photo is now cropped into a real `image/jpeg` blob before
upload (above), that content-type mismatch risk — and the multi-MB
mobile file size — are both gone by construction. If the bug turns out to
still reproduce on a real device after this, the fix above means it'll at
least surface a real, specific error message instead of failing silently.

**Instant local preview + upload loading indicator**: confirming the crop
(`handleCropConfirm`) shows the new photo immediately — swapped in via
`URL.createObjectURL(blob)`, stored in a `previewUrl` state, rendered in
place of `photoUrl` (`previewUrl ?? photoUrl`) — so the créateur sees the
result the moment they confirm the crop, before ever touching
"Enregistrer" (Instagram-style, per explicit instruction). The blob URL is
revoked (`URL.revokeObjectURL`) on unmount/replacement via a `useEffect`
cleanup, since nothing else releases it. Clicking "Enregistrer" then goes
through the real upload; while that's in flight
(`mainSave.status === "saving" && Boolean(file)`, exposed as
`isUploadingPhoto`), the photo thumbnail dims (`opacity-40`) with a
spinner overlaid on top and a "Envoi de la photo..." caption replaces the
"Nouvelle photo prête à enregistrer." one — so the transition from
"picked" to "actually saved" stays visibly progressive instead of a
silent jump. `previewUrl` is cleared back to `null` only once the main
submit actually succeeds (alongside the existing `file`/file-input reset),
so a failed upload leaves the local preview in place rather than
reverting to the old photo. Verified end-to-end with a Playwright script
driving a real crop → confirm → save flow against a mocked upload
pipeline with artificial delays, confirming both the instant-preview text
and the mid-upload spinner/caption appear at the right moments.

## Public handle (`/@pseudo`)

Route is `src/app/[locale]/[handle]/page.tsx` — **deliberately not** a
folder named `@[pseudo]` (Next.js reserves a leading `@` in a folder name
for parallel route slots). `[handle]` captures the whole segment
including the literal `@`. Two things that bit us here, now fixed and
covered by tests/comments in place:
1. `params.handle` is **not auto-decoded** — a literal `@sergio` in the
   URL arrives as `%40sergio`; must `decodeURIComponent()` before
   checking the `@` prefix, or every handle 404s regardless of locale
   (this was a real shipped bug, fixed after being reproduced against a
   live dev server — see git history).
2. The pseudo lookup uses `ilike` for case-insensitivity, but `_` is both
   a valid pseudo character and an ILIKE wildcard — the pseudo must be
   escaped (`\_`, `\%`, `\\`) before the `ilike` call or near-matches
   would incorrectly succeed.

`/createur/[id]` (by real user id) stays the canonical/internal route;
`/@pseudo` is a public alias on top. Both render the same
`CreateurProfileView` fed by `getCreateurProfileData()`
(`src/lib/profil.ts`) — don't duplicate that query logic if adding a third
entry point. The header shown there is `displayName ?? t("heading")` —
`displayName` is `getCreateurProfileData`'s resolved
`resolveDisplayName(nomAffichage, pseudo)`, so it's never null-checked
again in the component; the generic translated "Profil créateur" heading
is only a last-resort fallback for a créateur with neither set.

Profile photo, when set, uses the same `ZoomablePhoto` component
(`src/components/ui/ZoomablePhoto.tsx`) as `/parametres` — click to open
a simple full-screen preview, click-outside or ✕ to close. Shared rather
than duplicated so both surfaces stay in sync; see "Réglages" below for
why `/parametres` needed this component in the first place.

Social links: `socialLinks` (`{ tiktok, instagram, youtube, autre }`,
all nullable) renders as a row of icon chips (`SOCIAL_LINK_ICONS`,
emoji — no icon library), one per platform that's actually set. This is
distinct from `lienReseauSocial`, which the view still returns but
`CreateurProfileView` no longer renders anywhere — see the
`lien_reseau_social` schema entry above for why.

## Explorer (`/[locale]/explorer`, added `0009`)

Public créateur directory — reverses an earlier "no browse page" decision
(see "Product judgment calls" below). Server component, no auth, reads
only `profils_explorables` + `offres_publiques` (both public views,
granted to `anon`). Search (`q`, matched against `pseudo`/`bio` via
`.or()` + `ilike`, escaped through `escapeIlike()` in
`src/lib/validation.ts` — the same escaping `/@pseudo` needs, don't
reimplement it a third time) and offer-type filter (`type`) are plain GET
query params read via `searchParams`, so filtering/pagination work
without client JS: the filter bar is a native `<form method="get">`, and
pagination links are plain `<Link href="/explorer?...">`. Type filtering
is a two-step query (first resolve matching `createur_id`s from
`offres_publiques`, then `.in("id", ...)` against `profils_explorables`)
since the two are separate views with no PostgREST-embeddable
relationship. Cards link to `/@pseudo` when the créateur has one, else
fall back to `/createur/[id]`.

## Private leaderboard progress + public `/classement` page (migration `0019`)

Two additions on top of the existing rank-only leaderboards
(`classement_volume`/`classement_reactivite`/`classement_progression`,
migration `0008`) — neither changes those three views at all.

**1. `mes_progres_classement()` — private, self-only real numbers.**
Unlike the public views (rank only, never a count or amount — see their
own section above), the dashboard needs to tell a créateur something like
"Plus que 3 transactions livrées pour entrer dans le top 10 volume ce
mois-ci", which means exposing a real count and a real gap. This is a
`SECURITY DEFINER` SQL function, not a view guarded by a `create policy`
— and deliberately so: Postgres row-security policies only ever attach to
**tables**, never to views or functions, and this computation inherently
needs to read every opted-in créateur's transactions to work out the
current 10th-place threshold, something a view that stayed subject to the
real per-user `transactions` SELECT policy (via `security_invoker`) could
never do at all. A view owned by the migration role (bypassrls, the same
mechanism `classement_volume` etc. already rely on) *could* compute the
threshold, but would then have nothing stopping any authenticated caller
from reading every row unless the view itself hardcoded a self-only
filter — and Postgres views can't carry `create policy` restrictions
either way.

So this follows the pattern already established everywhere else in this
codebase for "must be self-only, needs elevated read access to compute":
same shape as `accept_transaction`/`refuse_transaction`/
`set_admin_status` — it takes **no target-user parameter at all**, reads
`auth.uid()` internally, and raises if it's null. There is no argument a
caller could ever pass to ask for someone else's numbers. `EXECUTE` is
revoked from `public` and granted only to `authenticated`, never `anon` —
real Postgres permission enforcement, not just application logic,
verified in `checklist_2_3.sql` via `SET ROLE anon`/`SET ROLE
authenticated` (a new technique for this test file — see below).

Per leaderboard, it returns: the créateur's own real count/average
(`volume_actuel`, `reactivite_actuelle_secondes`, `progression_actuel`),
the value currently held by whoever sits in 10th place among opted-in
créateurs (`*_seuil_top10`, `null` when fewer than 10 opted-in créateurs
exist at all — meaning there's no real competition for a top-10 spot),
and the gap still needed (`*_manque`). Réactivité's `manque` is `null`
(not a misleading `0`) until the créateur has at least one qualifying
response of their own — there's nothing meaningful to compare yet.
Progression additionally returns `progression_eligible`: same 30-day
account-age scoping as `classement_progression` itself, so an account
older than 30 days gets `null` progression numbers instead of a
comparison that could never apply to them.

`src/lib/classementProgres.ts` holds the pure, unit-tested (
`classementProgres.test.ts`) French copy/formatting on top of these raw
numbers (`describeVolumeProgres`, `describeReactiviteProgres`,
`describeProgressionProgres`, `formatDureeSecondes`,
`computeProgressPercent`/`computeReactiviteProgressPercent` — the latter
inverted, since a *lower* average response time is what qualifies).
`ClassementProgresCard.tsx` renders three progress bars (same
bordered-track style as the campaign progress bar, see "Fundraising
campaigns" above) on the dashboard, fed by a single
`supabase.rpc("mes_progres_classement")` call alongside the existing
per-leaderboard `maybeSingle()` rank queries. Shown regardless of the
créateur's own `classement_public` opt-in status — it's meant to show
what it would take to qualify, which is useful encouragement even before
opting in.

Verified end-to-end against a real Postgres instance in
`checklist_2_3.sql`, not just read from the function's source: a
controlled pool of 10 competitor créateurs with delivered-don counts
10..1 plus "me" at 0 gives a real top-10 threshold of 1, so "me" is
correctly reported as exactly 1 transaction short; a different opted-in
créateur in the same run sees their own distinct numbers (never "me"'s)
when called under a different `app.current_user_id`; an account older
than 30 days gets `progression_eligible = false` and null progression
numbers while its volume numbers are unaffected; `anon` gets a real
`insufficient_privilege` error attempting to call the function at all;
and `authenticated` with no `auth.uid()` set gets the function's own
`not authenticated` exception. The `SET ROLE anon`/`SET ROLE
authenticated` technique used for the last two is new to this test file
(every earlier test ran everything as the superuser applying the
migrations, relying on `auth.uid()`'s stubbed session variable alone) —
it's what makes the `EXECUTE` grant a genuinely-enforced check in the
test rather than just descriptive.

**2. `/classement` — public leaderboard page (no auth required).**
**Updated after initial ship (still migration `0019`'s feature, no new
migration): dropped the Top 10 progression section from this page
specifically**, per explicit product instruction — the per-profile
progression rank badge on `CreateurProfileView` (fed by a completely
separate query in `src/lib/profil.ts`) is untouched, only this public
leaderboard page's own third section was removed. Now two sections (Top
10 volume/réactivité), laid out side by side in two columns on desktop
(`grid md:grid-cols-2`) and stacked on mobile — the classement_progression
view itself is untouched (still used by `CreateurProfileView`'s rank
badge), but `getClassementPublicData()` no longer queries it at all,
since fetching a table this page never renders would be pointless, not
just unused code.

Each remaining section reads straight from the existing public
`classement_volume`/`classement_reactivite` views (`rang <= 10`, ordered
by `rang`) plus `profils_publics` for the display bits
(photo/pseudo/nom_affichage) — the exact same public view `/explorer`
and `/@pseudo` already read from. `src/lib/classementPublic.ts#getClassementPublicData()`
is the only place this page queries from; it never touches
`users`/`transactions` directly and never selects a column beyond
`createur_id, rang` from the classement views or the four display
columns from `profils_publics` — asserted directly in
`classementPublic.test.ts` by spying on every `.from()`/`.select()`
call, the same "prove the view/query never leaks more than it should"
discipline this codebase already applies to `profils_explorables` (via
SQL) — here via a mocked Supabase client instead, since the property
being proven is about this page's own query shape, not a database view.
Cards link to `/@pseudo` when set, else `/createur/[id]`, same fallback
as `/explorer`'s cards.

Reserved pseudo: `'classement'` added to both
`users_pseudo_not_reserved` (migration `0019`) and
`PSEUDO_MOTS_RESERVES` — same requirement as every other new top-level
route.

**Nav link — deliberately visible to every visitor, unlike Explorer.**
Explorer's link only renders for an already-authenticated visitor (product
decision: don't pull a logged-out visitor away from signup/login
mid-flow). The leaderboard is the opposite case on purpose: it's built to
be reachable *without* an account, so `src/app/[locale]/layout.tsx` shows
it unconditionally, on every page including `/login`/`/signup` — treated
here as a feature (social proof that the platform has real activity), not
a distraction, though this is a reversible product call like the others
in this file.

Verified visually (Playwright against a throwaway mock of the Supabase
REST/Auth endpoints, same investigative technique as the "Logo-click
'logout' bug" section above): `/classement` renders its (now two)
populated sections with photo/name/rank and correct `/@pseudo` links,
side by side on a desktop viewport and stacked on mobile; and the
dashboard's new progress card renders three progress bars with the
expected French copy and fill percentages computed from a fixed
`mes_progres_classement()` fixture (e.g. "Plus que 3 transactions livrées
pour entrer dans le top 10 volume ce mois-ci" at a 4-of-7 fill).

## Fan loyalty badge (`badge_fidelite_public`, migration `0022`)

Non-monetary "Supporter de [créateur] depuis [date]" badge, opt-in, same
pattern as `classement_public`/`masque_exploration`: `users` gained a
single `badge_fidelite_public boolean not null default false` column,
toggled from `/parametres`. There is no fan/créateur role split in this
app (removed in migration `0006`), so the same person can simultaneously
have supporters (as a créateur) and hold badges of their own (as a fan
of other créateurs) — both directions are built here.

**The date is never stored.** It's always `min(created_at)` of the
`livree` transactions between one specific fan/créateur pair, computed
live — the exact same principle already applied to
`campagnes_montant_collecte` (migration `0017`): a second copy of a
derivable number/date is a real bug waiting to happen (it can drift out
of sync with the transactions it's supposed to summarize), not a
convenience.

**`badges_fidelite_publics` — a view, not a `SECURITY DEFINER` function,
and deliberately so.** Unlike `mes_progres_classement()` (which has to
compare the caller against a cross-user threshold, and therefore needs a
function that reads `auth.uid()` internally), this needs no per-caller
logic at all: it's a plain aggregate over `transactions`/`users`,
filtered once, by a column value, not by who's asking.

```sql
create view public.badges_fidelite_publics as
  select t.fan_id, t.createur_id, min(t.created_at) as depuis
  from transactions t
  join users u on u.id = t.fan_id
  where t.statut = 'livree' and u.badge_fidelite_public = true
  group by t.fan_id, t.createur_id;
```

Same shape as `profils_explorables`/`classement_volume` (migrations
0008/0009): owned by the migration role (bypassrls in a real Supabase
project), so it can freely read `transactions`/`users` to compute the
aggregate, but the `where u.badge_fidelite_public = true` clause is the
entire safety guarantee — a fan's row only ever appears here once they've
opted in, and there is no parameter to ask for a non-opted-in fan's row
instead. **This is the point flagged as a priority given the
`accept_transaction` history (migrations 0020/0021): a plain view has no
`EXECUTE` grant to even get wrong** — the vulnerable pattern was
specifically about a `SECURITY DEFINER` function's missing `revoke ...
from public`, which doesn't apply here at all since there's no function.
`grant select ... to authenticated, anon` is safe precisely because the
view's own `WHERE` clause, not the grant, is what restricts which rows
come back.

Exposes exactly three columns — `fan_id, createur_id, depuis` — never a
transaction count or a montant, same "aggregate rank/date only, never
the underlying number" discipline as `classement_volume`. Used in two
directions by the application, both reading the same view:
- Filtered by `createur_id` → a créateur's public "Supporters" section
  (`CreateurProfileView`, added alongside the existing `campagnes`/`offres`
  sections in `src/lib/profil.ts#getCreateurProfileData`).
- Filtered by `fan_id` → that same user's own public profile section
  listing which créateurs *they* support (same component, same page —
  there's no separate "fan profile" route).

**The private dashboard card is a completely different code path, on
purpose.** `badges_fidelite_publics` is filtered by
`badge_fidelite_public = true`, which is exactly the thing a fan's own
private view must never be gated by — a fan must always see their own
support history regardless of whether they've chosen to make it public.
So the dashboard reads `transactions` directly (`fan_id = auth.uid(),
statut = 'livree'`, already covered by the existing
`transactions_select_fan` RLS policy — no new grant needed) and computes
the earliest date per créateur in application code
(`computePremieresTransactionsParPartenaire`, `src/lib/badgesFidelite.ts`,
pure and unit-tested). Rendered by `BadgesFideliteCard.tsx`, shown only
once there's at least one badge — no empty/zero state, matching the
brief ("rien à afficher avant ça").

**Security-definer audit performed alongside this feature** (explicitly
requested, given the `accept_transaction` history): every other
`SECURITY DEFINER` function in the project was already checked in
migration `0021` (see that section above) — this feature added no new
`SECURITY DEFINER` function at all, so there was nothing new to audit
here beyond confirming that fact.

Verified in `checklist_2_3.sql` with real inserts, **both directions of
the privacy toggle, not just "on"**: a fan's badge is hidden by default
(`badge_fidelite_public = false`), appears the moment they opt in (with
`depuis` = the earliest of two `livree` transactions, not the latest),
never fabricates a row for a créateur with zero delivered transactions,
and disappears again immediately when the fan turns the setting back
off — plus an `information_schema.columns` check that the view exposes
exactly `créateur_id, depuis, fan_id`, never a montant or count (same
style as `classement_volume`'s "exposes rank only" test).
`profil.test.ts` additionally spies on `getCreateurProfileData`'s own
`.select()` calls to prove the application code asks for exactly
`fan_id, depuis` / `createur_id, depuis`, and that the final
`supporters`/`badgesFidelite` arrays it returns never carry a montant or
count field either.

Verified visually end-to-end (same throwaway mock-Supabase technique as
`/classement`): the private dashboard card renders "Supporter de
marie_creatrice depuis 16 juin 2026" (correctly the earliest of two
fixture transactions, not the 3-days-ago one); a créateur's public
profile shows both the "Supporters" section (an opted-in fan supporting
them) and their own "Badges de fidélité" section (créateurs they
support) at once, proving the two directions can coexist on one profile;
and the full toggle round-trip was driven through the real UI, not
simulated: unchecking "Rendre mes badges de fidélité publics" in
`/parametres` and saving made the "Badges de fidélité" section vanish
from the public profile on reload (while the unrelated "Supporters"
section, gated by a *different* user's flag, stayed put), and re-checking
it brought the section back.

## Signup: province/ville + password confirmation (migration `0012`)

**Province** is a dropdown dependent on the selected country, backed by
`src/lib/states.ts` / `src/lib/data/states.json`. That JSON is a
generated, filtered slice of the [Countries States Cities
Database](https://github.com/dr5hn/countries-states-cities-database)
(ODbL-licensed — attribution in `CREDITS.md`, per the license's
requirement): the full upstream dataset also carries cities and
postcodes for ~250 countries (states.json alone is ~6.4MB upstream);
this repo only keeps the states/provinces for the 38 real countries in
`COUNTRIES` (`lib/countries.ts`), pre-filtered and stripped down to
`{code, name}` at generation time (~45KB) — not fetched at runtime, so
signup has no third-party network dependency. French names are used
where the upstream `translations.fr` field has one (all 26 RDC
provinces do), falling back to the dataset's default (English) name
otherwise. `getStatesForCountry(code)` returns `[]` for a country with
no entry (only `"OTHER"` in practice — verified in
`states.test.ts`, which also asserts every real `COUNTRIES` entry has
at least one province, so a future country added there without
regenerating the dataset fails a test instead of silently showing an
empty dropdown).

`SignupForm.tsx`'s province `<select>` only renders when
`getStatesForCountry(countryCode)` is non-empty, and changing the
country (`handleCountryChange`) resets the selected province back to
`""` — otherwise a previously chosen province code could silently point
at the wrong region (or nothing at all) once the underlying list swaps
out. **Ville** is plain free text, capped at 100 chars client-side
(`maxLength`) — there's no usable finite list of cities worldwide, so no
dropdown was attempted.

Both are optional and sent through `raw_user_meta_data` the exact same
way `telephone`/`pays` already are — signup calls
`supabase.auth.signUp()` directly from the browser (there's still no
`/api/signup` route, see `handle_new_auth_user` below), and the trigger
was extended to pick up `province`/`ville` from the metadata the same
way it already reads `telephone`/`pays`/`bio`. Verified end-to-end with
the SQL checklist: a stub `auth.users` insert carrying `province`/`ville`
in its metadata results in a `users` row with both columns set, and a
second insert omitting them leaves both `null`.

**Password confirmation is client-side only, deliberately** — flagging
this rather than silently doing it, since the request that added this
asked for server-side enforcement "if the signup logic already checks
other rules there" (project discipline: invariants shouldn't rely on the
client alone). It doesn't apply here: signup has no server route in
front of it at all — the browser calls Supabase Auth's `signUp()`
directly, and only the one `password` value the user typed is ever
transmitted anywhere. The confirmation field is never sent; it exists
purely to catch a typo before the request goes out, so there is no
second copy of the password for a server to compare against, and
nothing a mismatched confirmation could bypass (unlike, say, the pseudo
cooldown, which really can be attacked by a direct REST call skipping
the app's client code entirely). `handleSubmit` checks
`password !== confirmPassword` and blocks the request with a translated
error (`t("passwordMismatch")`) before ever calling `signUp()`.

## Signup: nom/post-nom + 18+ age gate (migration `0016`)

**Nom/post-nom** are two plain text fields, both required, that
`SignupForm.tsx` concatenates client-side into a single `"{nom}
{postnom}"` string sent as `nom_affichage` in `raw_user_meta_data` —
deliberately **not** two new columns. `nom_affichage` already existed
(migration 0009) as a freeform public display name editable from
`/parametres`; this just gives it a value at signup time too, going
through the exact same trigger path `province`/`ville` already use
(`handle_new_auth_user`, extended again). Each field is capped at
`NOM_MAX_LENGTH` (29 chars client-side) specifically so the concatenated
result — `nom` + one space + `postnom` — can never exceed
`nom_affichage`'s existing 60-char DB constraint
(`users_nom_affichage_max_length`, migration 0009). Nothing about
`nom_affichage` itself changed: same column, same constraint, still
freely editable afterward from `/parametres` exactly as before — a
créateur can change it post-signup the same way they always could.

**Date of birth, with a real 18+ minimum enforced in the database, not
just the form.** `users.date_naissance date` is nullable (existing
accounts predate this column and can't be retroactively assigned a birth
date — same reasoning as `province`/`ville` in migration 0012), but the
signup form makes the field required going forward
(`required` + `max` on the `<input type="date">`). The actual guarantee
is `users_date_naissance_majorite`: `check (date_naissance is null or
date_naissance <= current_date - interval '18 years')`. **Verified with
real insertion attempts against a throwaway database before trusting the
syntax** (`checklist_2_3.sql`): a date exactly 18 years old today
passes, one day younger fails, 19 years old passes, NULL passes (a
Postgres CHECK only ever rejects a row when the expression evaluates to
`FALSE` — NULL is neither true nor false, so it can never fail a CHECK
on its own), and a full end-to-end `auth.users` insert with an under-18
`date_naissance` in its metadata is rejected with the `auth.users` row
itself rolled back too (same transaction, same trigger failure) — not
just a direct `UPDATE` on an already-existing row.

**Two independent client-side layers, on top of the DB constraint that
remains the real guarantee — verified with Playwright, not assumed:**
1. The date `<input>`'s `max` attribute (`minBirthDateForSignup()` in
   `src/lib/validation.ts`, mirroring the DB constraint's exact 18-year
   window) makes the browser's own native HTML5 constraint validation
   block submission immediately with an inline tooltip
   ("Value must be 07/25/2008 or earlier.") — confirmed live: typing an
   under-18 date and clicking submit never even fires React's
   `onSubmit` handler, the browser intercepts it first.
2. `handleSubmit` also calls `isAtLeast18(dateNaissance)` itself before
   ever calling `signUp()` — this is what actually matters, since `max`
   is trivially removable via devtools. Confirmed empirically: stripping
   the `<input>`'s `max` attribute via `page.evaluate()` (simulating
   exactly that bypass) and resubmitting the same under-18 date still
   blocks the request, this time via the translated `t("ageRestriction")`
   message ("Tu dois avoir au moins 18 ans pour t'inscrire.") shown
   in-form, with no network call made at all.
   `isAtLeast18`/`minBirthDateForSignup` both compute from **UTC**
   deliberately, not the visitor's local timezone — the DB's
   `current_date` is evaluated in the database session's timezone (UTC on
   Supabase), so a naive local-timezone comparison could shift the
   cutoff by a day right at the boundary for a visitor near midnight.
   This doesn't eliminate every edge case (a visitor's system clock can
   simply be wrong), which is exactly why the DB constraint stays the
   real guarantee, not either client-side layer.
   A real bug was caught writing the unit tests for these helpers before
   ever reaching the browser: `isAtLeast18("")` returned `true`, because
   an empty string sorts lexicographically before any real ISO date
   string — an unfilled field would have looked "at least 18". Fixed by
   explicitly rejecting an empty `dateNaissance` before the comparison;
   covered in `validation.test.ts`.

**What the user sees if the DB constraint itself is ever the thing that
fails** (only reachable in practice via the same kind of direct bypass
as layer 2 above, since both client-side layers block the normal path
first): GoTrue wraps a signup-trigger exception in a generic message
(commonly `"Database error saving new user"`, not the raw Postgres
`check_violation` text) rather than exposing the underlying SQL — this
project has no real Supabase project to confirm the *exact* wrapper text
against, so `SignupForm.tsx`'s `looksLikeAgeConstraintFailure()` treats
either that known generic wrapper string or any error text mentioning
`date_naissance` as the age case and shows the same friendly
`t("ageRestriction")` message either way, rather than ever surfacing
`error.message` verbatim for a database-shaped failure. Flagging this
the same way the CinetPay refund research was flagged: the precise GoTrue
wrapper text is asserted from general knowledge of Supabase's documented
behavior, not confirmed against a live project, since none exists in
this sandbox.

## Engagement/retention additions: copy-link, humanized fan status, payment celebration

Three independent, unrelated additions bundled in one request, each with
its own section below.

**"Copier mon lien" (`CopyProfileLinkButton.tsx`)** — a share-text-first
button (`Soutenez-moi sur FanBoss 👉 {origin}/@{pseudo}` — vouvoiement,
deliberately inconsistent with the rest of the app's tutoiement, per
explicit instruction, for this one string only), shown on the
dashboard's public-profile card and in `/parametres`'s pseudo block,
**only** once a pseudo is actually set (both call sites already had
their own "no pseudo yet" fallback UI; this button just slots in next to
the existing "real" state). ParametresForm passes the **saved** `pseudo`
prop, not the live-editing `pseudoValue` state — copying an unsaved
draft would share a link that doesn't resolve yet. Deliberately the
opposite priority order from `ShareCampagneButton` (share-first,
copy-fallback): this button's whole point is a quick clipboard copy for
pasting into a bio/story/DM, so Clipboard API is primary and
`navigator.share()` is only a fallback for the rare case a mobile
webview restricts clipboard writes — matching the button's own label
("Copier", not "Partager"). Verified live with Playwright: clicking it
copies the exact expected text to the clipboard and the button flips to
"Lien copié !" for 2s, in both the dashboard and `/parametres`.

**Humanized fan-facing status with a concrete deadline**
(`describeTransactionStatutFan()`, `src/lib/transactions.ts`) — the
dashboard's "Paiements envoyés à d'autres créateurs" list (moved to
`/finance` in Lot 2b, see "Wallet ledger + withdrawal requests" below —
the helper and its component (`TransactionActions`) moved with it
unchanged) previously showed a short human label (`en attente de réponse
du créateur`) but no
actual deadline. The new helper takes the transaction's
`deadline_acceptation`/`deadline_livraison` (now also selected in that
query, alongside the existing short colored badge which still shows a
one-word status for quick scanning) and produces a full sentence with a
real date/time — "En attente de réponse du créateur (réponse attendue
avant le 26 juil., 15:24)" for `en_attente`, "Accepté, en préparation
(livraison prévue avant le...)" for `validee` (only ever populated for
video/shoutout, since every other type skips straight past `validee` to
`livree` — see "Transaction lifecycle") — falling back to the plain
sentence when no deadline applies. The raw technical `statut` string is
never shown to the fan anywhere in this list anymore. Pure and
unit-tested (`transactions.test.ts`) independent of any date-formatting
concerns in the component itself.

**Payment-success celebration (`/paiement/retour`,
`PaiementRetourContent.tsx`, `Confetti.tsx`)** — a discreet, brand-colored
confetti burst (18 pieces, plain CSS keyframe in `globals.css`, no new
dependency, self-removes after 2.5s, `pointer-events-none` throughout so
it never blocks the page) plays on every load of this page, since its
entire purpose is a payment-success return. The warm message is adapted
per offer type when known, via a new `src/lib/paiementRetour.ts`
sessionStorage handoff: **CinetPay's `return_url` carries no reference
back to which transaction was just paid for** (confirmed by re-reading
`initiateCinetPayPayment()` — it's a static URL, no query params), so
`CheckoutButton` stashes the offer type in `sessionStorage` right before
redirecting to CinetPay's hosted checkout; since `return_url` points
back at this same origin, the value survives the round trip in the
*paying fan's own browser* and `PaiementRetourContent` reads (and clears)
it on mount. This is what makes the celebration inherently **fan-only,
never the créateur** — not a role check (this app has none), but a data
one: the créateur who receives the payment never has this
sessionStorage entry in their own browser, since they're never the one
who just completed this specific checkout in this specific tab. Falls
back to a generic "Merci pour ton paiement !" message when the value is
missing (sessionStorage disabled, direct bookmark visit, cross-device
link, etc.) — confetti still plays either way. Verified live with
Playwright by intercepting `/api/transactions/initiate` to redirect
straight back to this same route (simulating CinetPay's round trip
without a real account): the don-specific message
("Merci pour ton geste ! ...") renders correctly, and a fresh visit with
no sessionStorage entry shows the generic fallback instead.

## Réglages (`/parametres`, `ParametresForm.tsx`)

Pseudo and bio are both **read-only by default with a "Modifier" button
to unlock** (protection against accidental edits), but only pseudo has a
real cooldown behind it — bio's lock is pure UX, never blocked. Both
start already unlocked if the field has never been set (`useState(!pseudo)`
/ `useState(!bio)`): there's nothing accidental to protect on a first-time
value. The pseudo "Modifier" button itself is `disabled` while
`pseudoLockedUntil` (server-computed prop, see above) is non-null — the
UI can't even attempt an edit during the cooldown, though the real
enforcement is server-side regardless (`enforce_pseudo_cooldown` trigger
+ the `/api/profil` pre-check), never trust the disabled button alone.

Profile photo: clicking the photo **zooms it** (`ZoomablePhoto`, see
"Public handle" above) rather than opening the file picker — that used
to be the accidental behavior, because the `<img>` sat inside the same
`<label>` as the file `<input>`, and clicking anywhere in a label
associated with a control activates that control. Fixed by pulling the
file input out into its own hidden (`className="hidden"`) element,
triggered only by a separate "Modifier la photo de profil" button via
`fileInputRef.current?.click()`.

**Pseudo and bio each save independently**, via their own "Enregistrer"
button that only appears once unlocked — not as part of the main form's
submit. This lives outside `<form onSubmit={handleMainSubmit}>` entirely
(two standalone blocks below it, each with its own button calling
`patchProfil({ pseudo: ... })` / `patchProfil({ bio: ... })` directly)
specifically so saving one can never touch the other, or nom_affichage/
the social links/the checkboxes/the photo in the main form. All three
save paths (main form, pseudo, bio) share `useSaveStatus()`, a small
hook factory in `ParametresForm.tsx` wrapping "run this async action,
track saving/saved/error, auto-clear the saved message after 3s" — each
call site gets its own independent status. The main form's action is a
multi-step closure (optionally upload the photo, then PATCH) passed into
`run()`, so an upload failure still surfaces through the same error path
as a plain PATCH failure.

A successful pseudo save immediately: (a) re-locks the field
(`pseudoUnlocked → false`), (b) shows a one-time notice — "Pseudo
enregistré. Tu pourras le remodifier à partir du [date]." — computed
client-side as `now + PSEUDO_COOLDOWN_MS` (the same constant the server
just used to actually set `pseudo_modifie_at`), not re-fetched from the
server. This is deliberately a different message from the persistent
"Modifiable à nouveau à partir du..." hint that shows whenever the field
is locked for any reason — the notice is specifically about *this* save
having started a new 30-day window, so the créateur understands the
stakes of getting it right the first time, not just when they later try
to change it again. Bio has no such notice (no cooldown to explain), just
a plain "Bio enregistrée."

**Real-time pseudo availability check** (`GET
/api/pseudo/disponibilite`) — while the pseudo field is unlocked,
`ParametresForm.tsx` debounces the typed value (`PSEUDO_CHECK_DEBOUNCE_MS
= 400`) and asks this endpoint whether it's free, rendering a small
"✓ disponible" / "✗ déjà pris" / "✗ réservé" line under the field and
disabling "Enregistrer" until the *currently typed* value has a confirmed
positive check (clearing the pseudo entirely is always allowed — there's
nothing to check when unsetting it).

The endpoint returns **exactly `{ disponible: boolean }`, nothing else**
— no id, no indication of *whose* account holds the pseudo, not even on
a genuine hit. This isn't a new information leak either way: `pseudo` is
already public via `profils_publics`/`/@pseudo`, so confirming "this
exact handle is taken" reveals nothing a visitor couldn't already learn
by guessing a handle and loading `/@<guess>` directly — the endpoint just
saves that round trip during signup-time typing. It still requires a
real session (`401` for a logged-out caller) purely to identify the
caller for the self-exclusion check below, not because the boolean
itself is sensitive.

**Applies the exact same rules as the real DB constraints, from the same
source, never a hand-copied approximation**: `PSEUDO_FORMAT_REGEX`
(`src/lib/validation.ts`, extracted out of `parametresProfilSchema`'s
inline regex specifically so this route and the schema can't drift) and
`PSEUDO_MOTS_RESERVES` are checked first, entirely locally — a request
for a pseudo that could never pass `users_pseudo_format`/
`users_pseudo_not_reserved` never even reaches `profils_publics`. Only a
pseudo that clears both goes to a case-insensitive `ilike` lookup
(`escapeIlike()`, same escaping `/@pseudo`/`/explorer`'s search already
need) against `profils_publics`, mirroring
`users_pseudo_lower_unique_idx`'s `lower(pseudo)` semantics exactly. This
symmetry is the actual point: a pseudo this endpoint ever calls
`disponible: true` can never fail at real save time via `/api/profil`,
and vice versa — same discipline as `pseudoLockedUntil` mirroring the
cooldown trigger's 30-day window.

**Self-exclusion uses the caller's own authenticated id, never a
client-supplied one** — `match.id === user.id` (from `supabase.auth
.getUser()`), so typing your own current pseudo back reads as
"disponible" (it's already yours) without opening a way to ask "does
pseudo X belong to account Y" for an arbitrary Y. Selects only `id` from
`profils_publics`, discarded after the comparison — never returned to
the client.

**Can't be used to enumerate accounts at scale** — covered explicitly in
`route.test.ts` (9 tests): the response is always exactly one key,
`disponible`, a boolean, for a single requested pseudo; there is no
batch/list mode, no wildcard, and a request for a name that fails
format/reserved checks never even touches the database, so there's no
per-pseudo timing signal either from a query that didn't run.

The debounce and format/reserved-word classification are computed at
**render time** from a small `pseudoNetworkCheck` state
(`{value, status: "available" | "taken"} | null`, tagged with the value
it was actually checked against so a late response for an
already-superseded value is never shown as current) — not from a
separate `useState` set synchronously inside the `useEffect` body. An
earlier draft did set a `"checking"/"invalid"/"reserved"/"idle"` status
state directly inside the effect and was rejected by
`react-hooks/set-state-in-effect` (calling `setState` synchronously
inside an effect risks a cascading extra render); the fix derives
`pseudoDisplayStatus` from the local format/reserved classification plus
`pseudoNetworkCheck` on every render instead, leaving the effect to only
ever call `setPseudoNetworkCheck` from inside its `setTimeout`'s async
callback, which is not synchronous with respect to the effect's own
execution.

Verified visually end-to-end (same mock-Supabase/Playwright technique
used throughout this file): typing the créateur's own current pseudo
unchanged shows "✓ disponible"; a pseudo already held by another account
shows "✗ déjà pris"; a reserved word shows "✗ réservé"; a genuinely free
pseudo shows "✓ disponible" with exactly one network request fired only
after typing paused for the debounce window (not one per keystroke); and
"Enregistrer" is disabled for a taken value, enabled once a positive
check lands for the currently-typed one.

Bio's textarea is `resize-none` — the native resize handle looked
unpolished; `rows={4}` gives it a fixed, reasonable height instead.

Social links: four plain URL inputs (TikTok/Instagram/YouTube/Autre,
migration `0011`) inside the main form, saved together with
nom_affichage/checkboxes/photo — unlike pseudo/bio they have no
lock/unlock UX, nothing accidental to protect against for a plain
optional URL field.

## Logo

Two separate artifacts, deliberately not the same thing:
- `public/fanboss-logo.svg` — the static brand asset, hardcoded colors
  (`#7c3aed`/`#ff6b5e`/white), for contexts that need a real standalone
  file (social previews, email, sharing outside the app).
- `src/components/Logo.tsx` — the nav logo, same mark/wordmark but
  **inline SVG** using `var(--color-brand-500)`/`var(--color-accent-500)`
  for its fills. An externally-referenced `<img src="...">` can't inherit
  the host page's CSS custom properties, so it's the only way for the
  logo to follow `--color-brand-500`'s dark-mode override automatically
  -- rendering the static file via `<img>` would have frozen it at the
  light-mode color forever. Uses `useId()` for its gradient's `<linearGradient
  id>` so it stays collision-safe if ever rendered more than once on a
  page; that's also why it's a client component (`"use client"`) despite
  having no interactivity -- Server Components can't call hooks.

Rendered in `src/app/[locale]/layout.tsx`'s nav bar, wrapped in a
locale-aware `Link` to `/`, on the opposite side from the Explorer
link + language switcher (grouped together on the right). Explorer is
only rendered there for an already-authenticated visitor (`layout.tsx`
calls `createSupabaseServerClient().auth.getUser()` itself) — a
logged-out visitor on `/signup`/`/login` shouldn't see it pulling them
away from finishing that flow.

## Logo-click "logout" bug — investigated and fixed

A report came in that clicking the logo (→ `/`) logged the user out,
landing back on a password prompt, and that this touched every page
since the logo is in the shared layout. **This turned out not to be a
session bug at all** — proven, not assumed, by actually logging in and
tracing it (see below), which is why this section exists: so nobody
"fixes" `proxy.ts` or the cookie relay again based on the same plausible
but wrong assumption.

**How it was actually traced**, since this sandbox has no real Supabase
project to log into: a ~120-line mock of just the two Auth REST
endpoints the flow needs (`POST /auth/v1/token`, `GET /auth/v1/user`)
was stood up on a local port, with `NEXT_PUBLIC_SUPABASE_URL` pointed at
it. Everything *except* that network boundary was the real, unmodified
`@supabase/ssr`/`@supabase/supabase-js` code — real cookie writing, real
`getUser()` revalidation, run against both `next dev` and a genuine
`next build && next start`. A real login (email/password → session
cookie) was driven with Playwright, then the logo was actually clicked,
with temporary logging added to `proxy.ts` to print incoming cookies and
`getUser()`'s result on every request.

**Result: the session cookie was never touched.** `getUser()` succeeded
on every single request, before and after clicking the logo, across dev
mode, a production build, and both locales. Directly revisiting
`/dashboard` after clicking the logo worked with no redirect to
`/login`, proving the session was intact throughout.

**The real cause**: neither Home (`/`) nor `/login` acknowledged an
existing session.
- Home rendered "Créer un compte"/"Se connecter" unconditionally,
  regardless of whether the visitor was logged in — so a genuinely
  logged-in user clicking the logo landed on a page that looked exactly
  like the logged-out state.
- `/login` rendered the password form unconditionally too, with no
  check for an already-authenticated visitor.

A confused user, seeing what looks like a logged-out homepage, naturally
clicks "Se connecter" — landing on a *real* password prompt. Nothing was
ever destroyed; the app just never told them they were still logged in.

**The fix** (`src/app/[locale]/page.tsx`, `login/page.tsx`,
`signup/page.tsx`): all three now call
`createSupabaseServerClient().auth.getUser()` themselves. Home shows a
single "Accéder à mon espace" → `/dashboard` CTA instead of
signup/login when a user is present; `/login` and `/signup` `redirect()`
an already-authenticated visitor straight to `/dashboard`, the same
locale-aware `redirect({ href, locale })` pattern `/dashboard` and
`/parametres` already use in the other direction. This makes the
reported symptom — a password prompt appearing for someone who's still
logged in — structurally impossible rather than just less likely.

Regression tests: `page.test.ts` under `login/__tests__`,
`signup/__tests__`, and `[locale]/__tests__` mock
`createSupabaseServerClient` and assert the redirect/CTA branch taken for
both an authenticated and a logged-out caller, without needing a browser
or a real Supabase project.

## Logout

There was no sign-out path anywhere in the app until now (confirmed by
grepping for `signOut` before adding this — zero matches). `LogoutButton`
(`src/components/LogoutButton.tsx`) is a small client component rendered
in both `/dashboard`'s header (next to "Réglages") and `/parametres`
(next to "Retour au tableau de bord") — the two pages a logged-in user
actually lives in, so the control is always reachable without hunting for
it. Clicking it calls `supabase.auth.signOut()` on the **browser**
client, then `router.push("/")` + `router.refresh()` (the same
locale-aware `useRouter` from `@/i18n/navigation` used elsewhere, and the
same push-then-refresh order `LoginForm` uses in the other direction).

The signOut→redirect sequence is pulled out into a standalone
`signOutAndRedirect(supabase, router)` export specifically so it's
unit-testable without a DOM renderer (this project has no
jsdom/testing-library) — `LogoutButton.test.ts` asserts `signOut()`
resolves strictly before the navigation calls, so the redirect can never
race ahead of the session actually being torn down.

**This does invalidate the session server-side, not just locally —
verified empirically, not assumed**, the same way the logo-click bug
above was: a real login → click "Se déconnecter" → direct revisit to
`/dashboard` flow was driven with Playwright against the mock Supabase
Auth server (see "Logo-click 'logout' bug" above for why that harness
exists). Three things were confirmed directly, not inferred from reading
the code:
1. The browser actually sends `POST /auth/v1/logout?scope=global` — the
   *default* `signOut()` scope is `"global"`, which revokes the session
   via the Supabase Auth API itself (not the local-only `"local"` scope),
   so a copied/replayed refresh token can't resurrect the session either.
2. The `sb-*-auth-token` cookie is fully gone from the browser context
   immediately after the click (`@supabase/ssr`'s browser client clears
   it via its storage adapter's `removeItem`, triggered by `signOut()`)
   — not just visually hidden by a UI state change.
3. Directly navigating to `/dashboard` afterward — a fresh request, no
   client-side router state involved — server-redirects to `/login` and
   renders a real password form, exactly like a visitor who was never
   logged in. This is the same `getUser()`-based check every protected
   page already does (see "Logo-click 'logout' bug" above); logout needed
   no new server-side guard, only a way to actually clear the session
   that guard reads.

## Password reset & change

Two separate flows, both landing on `supabase.auth.updateUser({password})`
but reaching it from different starting points:

**Forgot password** (`/login` → `/mot-de-passe-oublie` →
`/reinitialiser-mot-de-passe`): the "Mot de passe oublié ?" link on
`LoginForm.tsx` goes to `/mot-de-passe-oublie`
(`MotDePasseOublieForm.tsx`), a plain email form calling
`supabase.auth.resetPasswordForEmail(email, { redirectTo:
"${origin}/auth/callback?redirect=/reinitialiser-mot-de-passe" })`. This
deliberately reuses `/auth/callback` — the same PKCE code-exchange route
signup already uses — rather than inventing a second route that could
fall into the same trap (see "Email confirmation / password reset link
404" above, found and fixed while building this). `/auth/callback`
already supported a `?redirect=` param (added for signup, unused until
now) that it forwards to after a successful `exchangeCodeForSession()`;
password reset is the first thing to actually pass a non-default value
for it. Once redirected to `/reinitialiser-mot-de-passe`
(`ReinitialiserMotDePasseForm.tsx`) with a now-real session already
established by the exchange, the créateur sets a new password (with
confirmation, same client-side-only mismatch check as signup — see
"Signup" above for why that's client-only by design) and the page calls
`updateUser({password})` directly, then redirects to `/dashboard`.
`/mot-de-passe-oublie` and `/reinitialiser-mot-de-passe` were both added
to `PSEUDO_MOTS_RESERVES` and the matching DB constraint (migration
`0013`) — every new top-level route needs this, see the pseudo section
above.

**`redirect` hardened against open-redirect abuse**: since it's now part
of an emailed link (attacker-visible/craftable, not just an internal
implementation detail), `/auth/callback/route.ts` exports
`safeRedirectPath()` which only accepts a same-origin relative path
(must start with `/`, must not start with `//`) and falls back to
`/dashboard` otherwise — covered by `route.test.ts`.

**Password change** (`/parametres`, already logged in): a
"Mot de passe" field in `ParametresForm.tsx`, same hidden-until-
"Modifier" affordance as pseudo/bio, but always starts locked (unlike
pseudo/bio, there's no existing value to protect against overwriting,
but the same click-to-reveal guard against an accidental change still
applies). Revealing it shows new-password + confirm fields and its own
"Enregistrer" button (`handlePasswordSave`, using the same
`useSaveStatus()` hook the rest of the form already shares), which calls
`supabase.auth.updateUser({password})` on the **browser** client
directly — no `/api/profil` involved, since password isn't a `users`
table column. No previous-password re-entry: the already-active session
is what authorizes the change on Supabase's side (GoTrue's `updateUser`
throws `AuthSessionMissingError` client-side, before any network call,
if there's no session at all — there always is one here, since
`/parametres` itself redirects a logged-out visitor to `/login`).

Both flows were verified end-to-end against the mock Supabase Auth
server (see "Logo-click 'logout' bug" above for why that harness
exists, now extended with `/auth/v1/recover`, `grant_type=pkce` token
exchange, and `PUT /auth/v1/user`): a real `resetPasswordForEmail()`
call, followed by simulating the emailed link
(`/auth/callback?redirect=/reinitialiser-mot-de-passe&code=...`), lands
on a working `/reinitialiser-mot-de-passe` form — in both `fr` (default)
and `/en/`-prefixed sessions, specifically re-checking the exact
`/auth/callback` + locale-prefix scenario that had been broken — a
password mismatch is caught before any network call, a real
`updateUser({password})` call is made (confirmed via the mock server's
own request log), and the session remains valid afterward (a direct
revisit to `/dashboard` doesn't bounce to `/login`). The `/parametres`
password field was verified the same way: locked by default, reveals on
click, mismatch blocked, and the real `PUT /auth/v1/user` call is
visible in the mock server's log once submitted correctly.

## i18n (next-intl)

Locales `fr` (default, unprefixed) / `en` (prefixed `/en`),
`localePrefix: "as-needed"`. All pages live under `src/app/[locale]/...`;
`src/app/api/**` and `src/app/auth/callback` are deliberately **outside**
`[locale]` (they're not pages; a next-intl rewrite over them would 404).
Being outside `[locale]` in the file tree is necessary but **not
sufficient** on its own — `src/proxy.ts`'s `config.matcher` must also
exclude them, or next-intl's middleware rewrites the request into the
`[locale]` tree anyway before the route handler ever runs. See "Email
confirmation / password reset link 404" below: this exact gap was found
live in this codebase (`/api` was already excluded, `/auth` was not) and
is now fixed by adding `auth` to the matcher's negative lookahead
alongside `api`. `src/proxy.ts` composes next-intl's middleware with the
Supabase session refresh — the refreshed cookies are written onto the
*same* response object next-intl produced (redirect/rewrite/pass-through),
not a fresh one. Root `src/app/layout.tsx` is a bare passthrough (`return
children`); the real `<html>`/`<body>`/`NextIntlClientProvider` live in
`src/app/[locale]/layout.tsx`.

### Email confirmation / password reset link 404 — found and fixed

Investigated while adding password reset (below), which reuses the same
`/auth/callback` redirect target signup already used. Before trusting
that target for a second flow, its behavior was actually checked against
a running dev server rather than assumed correct from the "it's outside
`[locale]` on purpose" comment already in this file — and it wasn't:
`curl -v http://localhost:3000/auth/callback?code=test` returned a plain
**404**, every time, regardless of `Accept-Language` or a `NEXT_LOCALE`
cookie. The response headers showed why:
`x-middleware-rewrite: /fr/auth/callback?code=test` — next-intl was
rewriting the request into the `[locale]` tree, where no
`app/[locale]/auth/callback` route exists (it deliberately lives outside
that tree — see above), so it 404s. `localePrefix: "as-needed"` only
controls whether the *URL bar* shows a prefix for the default locale; it
does not stop next-intl from doing its internal per-request rewrite that
every `[locale]` page relies on to resolve at all. `src/proxy.ts`'s
matcher already excluded `/api` from this rewrite (with a comment
explaining exactly this failure mode for API routes) but never excluded
`/auth` — meaning **every signup confirmation link has been 404ing**
whenever next-intl's rewrite kicked in, unrelated to anything about
password reset specifically.

Fixed by adding `auth` to the matcher's negative lookahead:
`"/((?!api|auth|_next|_vercel|.*\\..*).*)"`. Reverified the same way the
bug was found — `curl -v` against a real dev server, several times, with
and without an `Accept-Language`/`NEXT_LOCALE` override — `/auth/callback`
now reaches the route handler directly (no `x-middleware-rewrite` header
at all) and its own redirect logic runs as written (e.g. `/login?error=...`
for a bad/expired code), while `/login`, `/en/login`, and `/api/offres`
were all re-checked to confirm the exclusion didn't regress anything
else. `/reinitialiser-mot-de-passe` (below) does **not** need this same
exclusion — it's a real page under `app/[locale]/reinitialiser-mot-de-passe`,
so it's *supposed* to go through next-intl's rewrite the same way every
other page does; only routes deliberately living outside `[locale]`
(`/api/**`, `/auth/**`) need to be excluded from the matcher.

Fully translated (fr+en) — **every page and component now goes through
`useTranslations`/`getTranslations`, not just the ones a foreign visitor
hits first.** Dashboard and `/parametres` used to stay French-only "for
now, by design (lower priority for this MVP)" — that's no longer true,
see "Full i18n coverage extension" below for what closed that gap.
Internal navigation must use the locale-aware `Link`/`redirect`/`useRouter`
from `src/i18n/navigation.ts`, never plain `next/link`/`next/navigation`
— a few redirects (`/dashboard`, `/parametres` → `/login`) needed an
explicit `return;` after the redirect call for TypeScript to narrow
correctly afterward (the locale-aware `redirect`'s `never` return type
doesn't always get picked up by control-flow analysis the same way
`next/navigation`'s did).

### Full i18n coverage extension — dashboard, /parametres, /admin, offres, dynamic copy

The first i18n pass (above) deliberately left the dashboard, `/parametres`,
`/admin`, and everything added in later feature sessions (fundraising
campaigns, the fan loyalty badge, créateur verification, the ranking
progress card) hardcoded in French. This pass closed that gap
end-to-end, following the exact same pattern already established
(`useTranslations` in client components, `getTranslations` in async
Server Components, keys added to both `messages/fr.json` and
`messages/en.json`) rather than inventing a new one.

**New message namespaces**: `Common` (generic action words —
save/saving/saved/edit/cancel/confirm/update/add/activate/deactivate/
reactivate/close/unknownError/saveError — reused across `Parametres`,
`OffresManager`, and `Admin` instead of duplicating the same word in
every namespace), `Dashboard`, `Parametres`, `PhotoCropper`,
`Verification` (shared between the `/parametres` request form and the
`/admin` review UI — `PLATEFORME_LABELS`, i.e. TikTok/Instagram/YouTube,
were deliberately **left untranslated**: they're brand names, identical
in both languages), `OffresManager`, `Admin`, `CopyProfileLink`,
`LogoutButton`. Plus a new `Metadata` namespace for the `<head>`
description (`generateMetadata` replaces the old static `export const
metadata`), and a `Nav.homeAriaLabel` key for the logo link's
accessibility label.

**Two Server Components were audited and converted async specifically to
call `getTranslations`**: `ClassementProgresCard.tsx` and
`BadgesFideliteCard.tsx` had no `"use client"` directive and no hooks, so
they were already safe to call `await getTranslations(...)` directly
inside — no client-boundary churn needed, since a Server Component parent
(`/dashboard`) can render an async Server Component child exactly like a
sync one.

**Dynamic text generators — the part explicitly flagged as easy to
forget** (`describeTransactionStatutFan` in `src/lib/transactions.ts`,
`describeVolumeProgres`/`describeReactiviteProgres`/
`describeProgressionProgres` in `src/lib/classementProgres.ts`): these
returned hand-built French sentences, not JSX, so they were the one
category a page-by-page visual sweep could plausibly miss. Fixed by
threading a translator parameter through each function
(`StatutFanTranslator`/`ProgresTranslator` — a minimal `(key, values?) =>
string` shape, not next-intl's own type, specifically so these libs don't
need to import next-intl's heavier generic machinery) instead of
hardcoding text, with the actual French/English copy moved into
`messages/{fr,en}.json` (`Dashboard.transactionStatut`,
`Dashboard.statutShort`, `Dashboard.classementProgres.*`) using real ICU
plural rules (`{count, plural, one {...} other {...}}`) for the
"N transactions livrées" gap counts — this codebase's first use of ICU
plural syntax; every earlier count-with-plural string
(`nouvellesDemandes` here too) used it as well rather than a hand-rolled
`count > 1 ? "s" : ""` ternary.

**These are the two library functions with existing unit tests
(`transactions.test.ts`, `classementProgres.test.ts`) that asserted exact
French sentences** — updated to build a real translator via
`createTranslator` from `use-intl/core` (a named export, not default —
confirmed by reading `use-intl`'s own `.d.ts`, not guessed) seeded with
the **actual `messages/fr.json`** import, not a hand-typed duplicate
message object, so a future mistake in the message catalog fails these
tests too. `createTranslator`'s own `const`-generic inference ties its
`key` parameter to the literal shape of whatever `messages` object it's
given, which is far stricter than `StatutFanTranslator`/`ProgresTranslator`
need (and stricter than what `useTranslations`/`getTranslations` return
in application code, since this project declares no global message-type
augmentation) — the tests cast the constructed translator to the
library's own loose type rather than fighting the inference, with a
comment explaining why.

**`react-hooks`-adjacent gotcha**: `OffresManager.tsx`'s `QUESTIONS`
array (the whatsapp/shoutout/don/contenu/live copy, one of which
interpolates `WHATSAPP_PRIX_MINIMUM`) used to be a module-level constant
built once at import time — which can't work once the copy needs a live
translator. Renamed to `QUESTION_TYPES` (type/kind pairing only) and the
actual `question` string is resolved inside the component via
`t(`questions.${type}`, ...)` per render instead. Same fix shape for the
video-libelle `<datalist>` suggestions (`OffresManager.libelleSuggestions`,
pulled via `t.raw("libelleSuggestions")` rather than a hardcoded array)
and the campaign live-payout calculator sentence (`t.rich("liveCalculatorText",
{montant, b: ...})`, bolding just the amount the same way the original
JSX did with a `<span className="font-semibold">`).

**A real, pre-existing gap found while extending `CreateurProfileView.tsx`
— a file that was otherwise already fully translated**: the profile
photo's zoom-overlay `aria-label` (`"Agrandir la photo de profil"`) was
still a hardcoded French literal, missed by the original i18n pass
because it's an accessibility attribute, not visible body text. Moved to
`Common.zoomProfilePhotoAriaLabel` and reused from both
`CreateurProfileView.tsx` and `ParametresForm.tsx` (which has the same
zoom button on its own photo preview).

**Two categories of hardcoded French text were found but deliberately
NOT translated, flagged rather than guessed at:**
1. **API route error strings** (`{ error: "..." }` JSON bodies returned
   by `src/app/api/**` route handlers — validation failures in
   `src/lib/validation.ts`'s zod schemas, `whatsapp-link`'s prefilled
   `wa.me` message text, etc.). These routes live **outside** the
   `[locale]` tree on purpose (see above — a next-intl rewrite over them
   404s), so they have **zero locale context**: no `params.locale`, no
   request-scoped `getTranslations`, nothing. Some of these strings are
   genuinely user-facing (the WhatsApp prefilled message a fan sends to a
   créateur is real content, not a dev-only error), so this isn't a
   "doesn't matter" gap — but fixing it needs an actual design decision
   this codebase hasn't made yet (read `Accept-Language`, or have the
   client pass an explicit locale param, or switch to returning error
   *codes* that the calling client component translates itself) rather
   than a same-shape text swap. Left alone until that decision is made.
2. **Country/province names** (`src/lib/countries.ts`'s `COUNTRIES` list,
   consumed only by `SignupForm.tsx`, and the generated `states.json`
   dataset behind it). These are stored verbatim in `users.pays`/`.province`
   (see the schema section) — translating the dropdown's displayed name
   without changing what gets stored would mean the *same* country is
   saved under a different literal string depending on which locale the
   visitor signed up in ("États-Unis" vs "United States"), which would
   quietly fragment any future aggregation/analytics on that column. This
   needs a real data-modeling decision (keep storage canonical and only
   translate display, or move to storing an ISO code) that goes beyond
   this task's "swap hardcoded text for a translation key" scope. Left
   alone, flagged rather than guessed at.

Also found, confirmed **genuinely dead code, not a gap**:
`src/lib/verification.ts#STATUT_VERIFICATION_LABELS` (French-only status
labels) has zero references anywhere outside its own declaration —
grepped the whole `src/` tree to confirm before leaving it alone. Left
untouched rather than translating text nothing ever renders, or deleting
code unrelated to this task.

Verified visually end-to-end (same mock-Supabase/Playwright technique
used throughout this file, extended with two locale-scoped browser
contexts — `{locale: "fr-FR"}` and `{locale: "en-US"}` — after an initial
run without them gave false failures: Chromium's default
`Accept-Language` is English, which made next-intl's automatic
negotiation silently serve English content on the default,
**unprefixed** French route): dashboard, `/parametres`, `/admin`,
`/classement`, `/explorer`, and a créateur's public profile (campaign
card, live calculator, supporters/badges sections, admin's two
verification lists in both their "en attente" and "conflit" states) all
render correctly in both languages, with explicit marker-string
assertions confirming no French leaks onto the `/en/...` pages and no
English leaks onto the default ones. A créateur's own free-text content
(a campaign's description, in this case) deliberately stays as-authored
regardless of viewer locale — matching real behavior, since this app has
no machine-translation feature for user-generated content, and confirmed
not a bug.

## Supabase migration deployment (`.github/workflows/deploy-migrations.yml`)

Migrations no longer need to be copy-pasted into the SQL Editor: this
workflow runs `supabase db push` automatically on every push to `main`
that touches `supabase/migrations/`, using `supabase/setup-cli@v3`. No
`continue-on-error`/`|| true` anywhere in it — a failing push (bad SQL, a
wrong secret, a connection error) fails the job outright, shows as a red
❌ on the commit and in the Actions tab, and does not retry itself. See
the README's "Base de données" section for exactly which three GitHub
secrets this needs (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`,
`SUPABASE_DB_PASSWORD`), where to get each one, and why: a Supabase
Personal Access Token inherits the permissions of whatever account
generates it (it isn't independently scopable after the fact), so the
README recommends generating it from an org member restricted to a
**project-scoped Developer role** on just this project rather than from
the Owner account — confirmed against Supabase's own published
permissions matrix that Developer can manage the database/run SQL but
can't touch org settings, transfer/delete the project, or reset the DB
password itself. `SUPABASE_DB_PASSWORD` itself has no narrower equivalent
documented anywhere — it's a real Postgres password, full stop; the
README says so plainly rather than implying otherwise.

`supabase/config.toml` was generated once via a real `supabase init` (not
hand-written) so `supabase link`/`db push` recognize this repo as a valid
project directory — `project_id` inside it is just a local label ("fanbosss"),
unrelated to the real `SUPABASE_PROJECT_ID` secret used to link. Its
`[db].major_version` should be checked against the real project's Postgres
version before relying on anything that consults it (`db push` itself
doesn't, since it talks directly to the already-linked remote database,
not a local one).

### First-run failure: migration history was empty (fixed via `migration repair`)

This workflow's very first real run against production failed immediately
on `0001_schema.sql` with `relation "users" already exists`. Root cause,
confirmed rather than assumed: migrations `0001`–`0013` had only ever been
applied by hand (copy-pasted into the SQL Editor) before this workflow
existed, so `supabase_migrations.schema_migrations` — the CLI's own
bookkeeping table for "which migrations has this project already seen" —
was completely empty, even though every one of those migrations' actual
schema changes were genuinely live in the database. `supabase db push`
trusts that table, not the real schema, to decide what's "new"; with it
empty, it tried to replay everything from `0001`, and the very first
`create table users` collided with the table that was already there.
**No data was touched** — the run failed on the first statement of the
first migration, before anything else executed.

Fixed with `supabase migration repair`, which only ever writes rows into
`supabase_migrations.schema_migrations` — it does not touch any other
table and never re-runs a migration's SQL. Verified this precisely,
end-to-end, in a throwaway environment before running anything against
production: created a scratch Postgres database, applied `0001`–`0013`
directly via `psql` (reproducing "applied by hand" exactly), confirmed
`supabase migration list --db-url ...` showed all 14 versions with an
empty `remote` column (the exact reported symptom), ran
`supabase migration repair 0001 0002 ... 0013 --status applied --db-url ...`,
and confirmed: (a) `supabase_migrations.schema_migrations` now listed
`0001`–`0013` as applied, (b) every existing table/policy/trigger was
completely untouched, (c) `supabase migration list` now showed only
`0014` as pending, and (d) `supabase db push` then applied *only*
`0014` cleanly, with a second `db push` afterward correctly reporting
"Remote database is up to date." — full idempotency, confirmed by
actually running `repair` and `db push` twice each, not assumed.

Also found while testing this: `supabase db push` prints a "push these
migrations? [Y/n]" confirmation even when nothing needs re-running, and
`deploy-migrations.yml`'s `db push` step didn't pass `--yes` — empirically
it still completed fine non-interactively (no TTY) in this exact CLI
version, but that's unverified CLI-internal behavior, not a documented
contract, so `--yes` was added to the workflow to make it deterministic
rather than rely on that.

**The one-time repair itself was never run from CI** — it's a historical
reconciliation, not something `deploy-migrations.yml` should ever need to
do again, so it does not belong in that workflow. It was run once,
directly, from a terminal with real Supabase credentials neither
generated nor seen by Claude Code (per explicit instruction — secrets are
configured by the project owner directly in GitHub/Supabase, never pasted
into chat).

## Testing

- `npm test` (Vitest): HMAC verification, webhook handler branching
  (don/contenu_debloque/evenement_live → immediate validation, video →
  not), signed-URL delivery routes (auth/ownership/status checks before
  minting a URL), the `[handle]` route's percent-decoding, zod schemas,
  the photo-crop geometry (`imageCrop.test.ts` — covers scaling, the
  90°/270° effective-dimension swap, and pan clamping on both axes),
  `signOutAndRedirect` (`LogoutButton.test.ts` — signOut() resolves
  before navigation), the generated province dataset (`states.test.ts` —
  RDC's provinces resolve correctly, an unknown/`"OTHER"` code returns
  `[]`, no duplicate codes within a country, and every real `COUNTRIES`
  entry has at least one province), `/auth/callback`'s `safeRedirectPath`
  (`route.test.ts` — only a same-origin relative path is ever followed,
  see "Password reset & change"), the proxy matcher itself
  (`src/__tests__/proxy.test.ts` — asserts against the real shipped
  `config.matcher` regex, not a copy of it, that `/api` and `/auth` stay
  excluded from next-intl's rewrite while real `[locale]` pages don't),
  and the automatic-refund idempotency chain (`refunds.test.ts` — all four
  no-op conditions in order, the configurable-percentage calculation, and
  that a `refundCinetPayPayment()` failure never throws out of
  `processAutomaticRefund`; `cinetpay.test.ts` — the refund stub always
  throws; route tests for `/api/cron/check-deadlines` and
  `/api/transactions/[id]/refuse` — the refund attempt fires exactly when
  expected and never on an auth/RPC failure; see "Automatic CinetPay
  refunds"); and the signup age-gate helpers (`validation.test.ts` —
  `minBirthDateForSignup`/`isAtLeast18` against a fixed reference date,
  covering both boundaries — exactly 18 today passes, one day younger
  fails — and the empty-string case, which is what caught the
  lexicographic-comparison bug described in "Signup: nom/post-nom + 18+
  age gate" before it ever reached the browser); the fundraising-campaign
  helpers (`campagnes.test.ts` — `computeCampagneStatus`'s full priority
  order (objectif_atteint beats a passed date_fin beats a manually-paused
  campaign), the date_fin boundary (still active through its own day),
  `computeCampagneProgressPercent`'s clamping, and `computeJoursRestants`);
  `creerOffreSchema`'s campagne validation (`validation.test.ts` — title/
  description/objectif required, a zero-or-negative objectif rejected, a
  malformed date_fin rejected, a well-formed campagne with no prix at all
  accepted); and the webhook's campagne handling
  (`route.test.ts` — moves straight to livree like don/contenu_debloque/
  evenement_live, and specifically that a campagne contribution is never
  rejected by the prix-match check despite `prix` being null); and
  `describeTransactionStatutFan` (`transactions.test.ts` — a concrete
  deadline is included for `en_attente`/`validee` when one is set, a
  plain sentence when it isn't, and the raw technical statut string is
  never what gets shown, including for an unrecognized value); the
  private leaderboard-progress copy/math (`classementProgres.test.ts` —
  singular/plural wording at a gap of exactly 1, the "already qualifies"
  vs. "no data yet" branches for réactivité, `formatDureeSecondes`
  rounding up so a few seconds never displays as "0 min", and both
  progress-percent helpers' clamping, including réactivité's inverted
  one); and the public `/classement` page's data query
  (`classementPublic.test.ts` — spies on every `.from()`/`.select()` call
  to assert it only ever touches `classement_volume`/`classement_reactivite`/
  `profils_publics`, never `users`/`transactions`/`classement_progression`
  directly, and that it selects exactly `createur_id, rang` from the
  classement views and exactly the four public display columns from
  `profils_publics` — never a count or amount); the fan loyalty badge
  helpers (`badgesFidelite.test.ts` — `computePremieresTransactionsParPartenaire`
  keeps the earliest date per créateur regardless of input order, tracks
  several créateurs independently, and `formatDepuis` in both locales);
  and `getCreateurProfileData`'s badge queries (`profil.test.ts` — spies
  on `badges_fidelite_publics`' two `.select()` calls to assert they ask
  for exactly `fan_id, depuis` / `createur_id, depuis`, never a montant
  or count, and that the resulting `supporters`/`badgesFidelite` arrays
  never carry one either).
- `npm run test:sql` (`supabase/tests/run_sql_tests.sh` +
  `checklist_2_3.sql`): creates a throwaway Postgres database (via
  `sudo -u postgres psql`, **not** Docker — Docker's daemon isn't running
  in this sandbox), applies every migration in order, then asserts
  against real constraint violations/trigger behavior: whatsapp price
  floor (can't be bypassed via UPDATE or via `config`), the commission
  rate (`create_paiement_on_validation()` charges 17% on a real
  transaction reaching `validee`, with `frais_agregateur`/`tva` still
  computed but no longer deducted from `montant_net_createur` — see
  "Commission rate", migration `0018`), both deadline-cron
  cases, the new offer types + `video`'s libelle exemption vs. every
  other type's strict one-per-type rule, pseudo format/case-insensitive
  uniqueness/reserved words, `repondu_at` tracking, that the
  classement views are rank-only and opt-in-only, `nom_affichage`'s
  length constraint, `'explorer'`/the password-reset routes landing in
  the reserved-pseudo list,
  `profils_explorables`'s exact visibility rule (has an active offre,
  not masked, and never leaks `masque_exploration` itself), and the
  pseudo cooldown trigger — including the two failure modes that matter
  most: a repeat change inside the 30-day window is rejected, and
  directly backdating `pseudo_modifie_at` in the same request (the RLS
  bypass an app-only check couldn't stop) still doesn't unlock it. The
  cooldown's "time has passed" case is tested by disabling the trigger
  as the test harness (`alter table users disable/enable trigger
  trg_enforce_pseudo_cooldown`) to backdate the timestamp, since the
  trigger itself refuses to let a normal UPDATE do that. **This is the real
  proof that constraints hold — always extend this file rather than just
  describing new DB behavior in prose.** Also covers `province`/`ville`'s
  max-length constraints and, by inserting directly into the stubbed
  `auth.users` with a `raw_user_meta_data` payload, that
  `handle_new_auth_user` actually picks both up from signup metadata (and
  correctly leaves both `null` when they're omitted). Also covers the
  automatic-refund trigger: both refund paths
  (`process_transaction_deadlines`, `refuse_transaction`) always set
  `necessite_remboursement_manuel`, and `remboursement_cinetpay_actif`/
  `remboursement_pourcentage` seed to their correct defaults. Also
  covers the admin-role trigger and RPCs (0015) with an explicit attack
  simulation, the same pattern as the pseudo-cooldown bypass test: a
  normal user's direct `UPDATE ... set est_admin = true` on their own
  row is rejected (`enforce_est_admin_change`), the very first admin can
  still be bootstrapped via a direct `UPDATE` with no `auth.uid()`
  context (SQL Editor/migration, never reachable through the app),
  `set_admin_status()` lets an existing admin grant/revoke another
  user's status while rejecting a non-admin caller (including a
  self-promotion attempt via the RPC itself, not just the raw column),
  and `mark_remboursement_manuel_traite()` rejects a non-admin caller
  and, for an admin, clears `necessite_remboursement_manuel` without
  ever fabricating `reference_remboursement_cinetpay`/`montant_rembourse`
  (those specifically mean "a real automated CinetPay call was
  confirmed," which a manual dashboard action isn't). Also covers
  `users_date_naissance_majorite` (0016) with real insertion
  attempts: an under-18 date is rejected, a date one day short of 18
  years is rejected (boundary), exactly-18-today and older dates are
  accepted, NULL is unaffected, and a full end-to-end `auth.users` insert
  with an under-18 `date_naissance` is rejected with the `auth.users` row
  itself rolled back (not just a direct `UPDATE` on an existing row) —
  plus that `handle_new_auth_user` correctly picks up `nom_affichage` and
  `date_naissance` from signup metadata (and leaves both `null` when
  omitted). Also covers fundraising campaigns (0017) with real
  insert/update sequences: a campagne stays active while its collected
  total is below the objectif, auto-closes (`actif = false`) the instant
  a contribution reaches or exceeds it, `campagnes_montant_collecte`
  reflects the live sum, a closed campagne stays visible in
  `campagnes_publiques` while disappearing from `offres_publiques` (the
  two views' deliberately different filtering), and
  `close_expired_campagnes()` closes only a campagne whose date_fin has
  strictly passed — a control campagne whose date_fin is still *today*
  is confirmed to remain untouched. Also covers `mes_progres_classement()`
  (0019) against a controlled pool of 11 opted-in créateurs: the real
  top-10 volume threshold is computed correctly and the calling créateur
  gets an exact, correct gap; a different opted-in créateur in the same
  run sees only their own numbers, never the first caller's; an account
  older than 30 days gets null progression numbers while its volume is
  unaffected; and — via `SET ROLE anon` / `SET ROLE authenticated`, a
  technique new to this file (every earlier test ran as the superuser
  applying the migrations) — `anon` gets a real `insufficient_privilege`
  error attempting to call the function at all, and `authenticated` with
  no `auth.uid()` set gets the function's own `not authenticated`
  exception. Also covers the `'classement'` reserved pseudo (0019). Also
  covers the `accept_transaction`/`refuse_transaction`/`deliver_video`
  anonymous-caller bypass fix (0020): `SET ROLE anon` gets a real
  `insufficient_privilege` error on all three, `SET ROLE authenticated`
  with no `auth.uid()` set gets each function's own `not authenticated`
  exception, and a final assertion confirms none of the six rejected
  attack attempts left any trace on the targeted transactions. Also
  covers the SECURITY DEFINER grant audit (0021): `SET ROLE anon` gets a
  real `insufficient_privilege` error on `process_transaction_deadlines`/
  `close_expired_campagnes`/`set_admin_status`/
  `mark_remboursement_manuel_traite`, none of the four rejected calls
  left any trace, a positive check confirms `service_role`/
  `authenticated` still hold `EXECUTE` on their respective functions, and
  `handle_new_auth_user()` is confirmed uncallable directly (Postgres's
  own trigger-function restriction, not a grant). Also covers the fan
  loyalty badge (0022) with real inserts: `badges_fidelite_publics` hides
  a fan's badge by default, shows it (with `depuis` = the earliest of two
  `livree` transactions, not the latest) once `badge_fidelite_public` is
  turned on, excludes a fan who never opted in even though they also
  delivered a transaction to the same créateur, never fabricates a row
  for a créateur with zero delivered transactions, hides the badge again
  immediately once the setting is turned back off, and exposes exactly
  `createur_id, depuis, fan_id` — never a montant or transaction count.
  Also covers créateur verification (0023) with a real scenario: two
  créateurs with normalized-equal display names (different case/accents/
  whitespace) conflict immediately, the first's still-pending request
  flips to `conflit` too, an unrelated third créateur's own request is
  untouched, `createur_verifie` stays false on both sides until an admin
  approves one, approving one side never auto-touches the other, and
  `profils_publics` exposes the badge only for the approved créateur.
  `SET ROLE anon`/`SET ROLE authenticated` confirm the same safe grant
  pattern as migrations 0020/0021: `anon` has no `EXECUTE` on any of the
  three new functions, `creer_demande_verification` rejects a NULL
  `auth.uid()`, and `approuver_verification`/`refuser_verification`
  reject a genuinely-authenticated non-admin caller. Also covers the
  Lot 2a fan-confirmation mechanism (0025) with real deliver_video()/
  accept_transaction() calls: delivery opens a real ~72h confirmation
  window, manual confirmation stamps `confirme_at` without touching
  `statut`, a second confirmation attempt on an already-confirmed
  transaction is rejected, disputing freezes the transaction without
  ever setting `necessite_remboursement_manuel` or attempting a refund,
  the auto-confirmation sweep confirms only a transaction past its
  deadline while leaving a sibling with a still-open window untouched,
  whatsapp/don transactions reaching `livree` never have
  `confirmation_fan` touched, and the full 0020/0021 security pattern
  (`anon` has no `EXECUTE` on any of the three new functions,
  `authenticated` with a NULL `auth.uid()` is rejected, a different
  authenticated user can't act on someone else's transaction, none of
  the rejected attempts leave a trace, and the legitimate callers still
  hold `EXECUTE`). Also covers Lot 2a-bis's litige resolution (0026) with
  real `resoudre_litige()` calls on genuinely disputed video/shoutout
  deliveries: `faveur_fan` sets `statut = remboursee` and is confirmed to
  ride the pre-existing `handle_transaction_remboursement()` trigger
  (`paiements.statut_paiement = 'rembourse'`,
  `necessite_remboursement_manuel = true`) rather than duplicating it;
  `faveur_createur` reuses `confirmation_fan = 'confirme'` and stamps
  `confirme_at` without touching `statut`; a second resolution attempt on
  an already-resolved litige is rejected; a genuinely non-admin
  authenticated caller (the créateur on the very dispute, proving even an
  interested party can't rule in their own favor) is rejected; the same
  NULL-safe `not authorized` rejection fires for `authenticated` with no
  `auth.uid()` set; `anon` has no `EXECUTE` at all; none of the rejected
  attempts leave a trace; and `authenticated` still holds `EXECUTE`. Also
  covers Lot 2b's wallet ledger + withdrawal requests (0027) against a
  dedicated fixture créateur with one transaction per bucket: all three
  `solde_wallet_createur()` buckets compute to the exact expected numbers
  under the real 15% HT + TVA formula; resolving one of the disputed
  transactions `faveur_createur` moves it from `en_litige` into
  `net_a_retirer` with no code in this migration aware a litige was ever
  involved; `demander_retrait()` rejects a sub-$25 amount and an amount
  exceeding the real server-recomputed balance (including a direct RPC
  call with a falsified amount), leaving no row behind either time; a
  pending request is subtracted from `net_a_retirer` immediately, a
  `traite` one keeps being subtracted, and a `refuse`d one stops; a
  second decision on an already-handled request is rejected;
  `traiter_retrait()` rejects a non-admin caller including the requesting
  créateur trying to self-approve; and the full `0020`/`0021` security
  pattern holds for all three new functions, including
  `solde_wallet_createur()` rejecting a caller asking for someone else's
  balance. Also covers the Lot 3 `/offres` route addition (0028): the
  `'offres'` reserved-pseudo CHECK constraint rejects a fresh user
  attempting to set it, same pattern as the `'classement'` test. Also
  covers Lot 5a's publications (0029) with a real fixture (a verified
  créateur, a real supporter via a `livree` transaction, a stranger, and
  an admin who is deliberately *not* itself `createur_verifie`):
  `soutient_createur()` correct for both the supporter and the stranger;
  an admin's post is forced to `type=annonce_fanboss`/`visibilite=public`
  regardless of what was requested; a real supporter sees both a
  créateur's `public` and `soutiens` post in full via
  `publications_visibles`, while a stranger and an anonymous viewer both
  get `contenu`/`image_r2_key = NULL` and a clean `contenu_complet =
  false` (not SQL NULL) for the `soutiens` one — the actual proof the
  teaser is a DB-level guarantee, not a client-side hide; the créateur
  always sees their own posts in full; `publications_accueil` includes
  the verified créateur's posts and the FanBoss announcement together;
  the 10/24h rate limit rejects an 11th post within the window and leaves
  no row behind; a non-verified, non-admin caller is rejected outright;
  and the full `0020`/`0021` security-grant pattern holds, including the
  one deliberate exception where `anon` **does** correctly have `EXECUTE`
  on `peut_voir_publication_complete()` (see CLAUDE.md's own section on
  why). Also covers the `'home'` reserved pseudo (0029), same pattern as
  `'classement'`/`'offres'`. Also covers Lot 5b's publication moderation
  (0030) with the same fixture: `signaler_publication()` rejects a
  stranger reporting a soutiens-only post they can't fully see (no row
  left behind) and accepts the identical report from a real supporter,
  recorded with the correct shape; `masquer_publication()` rejects a
  non-admin and, for an admin, makes the masked publication disappear
  from both `publications_visibles` (even for its own auteur) and
  `publications_accueil` immediately; `traiter_signalement_publication()`
  rejects a non-admin, `rejeter` leaves the publication's `masque`
  untouched while `masquer` sets it, a second decision on an
  already-handled report is rejected, and the full `0020`/`0021`
  security-grant pattern holds for all three new functions. Also covers
  Lot 5c's publication engagement (0031) with its own fixture (créateur A
  — verified, posts the originals; créateur B — verified, reposts;
  fan C — a stranger; admin D; fan E — a real supporter of A):
  `toggler_like_publication()` toggles on/off correctly and rejects
  liking a `soutiens`-only post a stranger can't fully see;
  `toggler_repost_publication()` rejects, individually, a non-verified/
  non-admin caller, a `soutiens`-only target, `autorise_repost =
  'personne'`, a masked target, and reposting a repost, then succeeds for
  a genuinely eligible caller/target and shares its 10/24h rate limit
  with `publier_message()` (an 11th action — a repost — is rejected); a
  second call on the same target is confirmed to toggle the repost off
  rather than being rejected (updated for migration `0032`, see below —
  this file's own test coverage was updated in place rather than left
  describing the original one-way behavior); the masking cascade is
  proven directly — a repost disappears from **both**
  `publications_visibles` and `publications_accueil` the instant its
  referenced original is masked, while the repost's own `masque` flag
  stays `false` throughout, the single most important behavior in this
  lot; `partager_publication()` is confirmed idempotent (two calls from
  the same fan leave the count at 1, one row, not two);
  `toggler_mute_createur()` rejects a self-mute and proves the mute
  asymmetry directly (excluded from `publications_accueil`, completely
  unaffected in `publications_visibles`, for the same querying fan), with
  a second toggle confirmed to un-mute; and the full `0020`/`0021`
  security-grant pattern holds for all four new functions plus the
  updated 4-arg `publier_message()`. Also covers the Lot 5c follow-up
  (0032) with its own fixture (créateur A — verified, créateur B —
  verified, fan C — a stranger, admin D): `masquer_ma_publication()`
  rejects a non-owner (leaving `masque` untouched) and succeeds for the
  owner, with the masked row confirmed gone from `publications_visibles`,
  and a second call on an already-masked row confirmed to leave it
  masked forever (no unmask path exists); `toggler_repost_publication()`
  (renamed from `reposter_publication`, confirmed gone outright as
  `undefined_function`, not merely inaccessible) is proven to toggle a
  full create → delete → create cycle, with the delete independently
  confirmed at the database level; it's confirmed to never delete a row
  that isn't a repost (a plain post survives the call unchanged); the
  quota-release chain is proven end to end (a rejection at the rate
  limit, freed by toggling an existing repost off, then a successful new
  repost); and the full `0020`/`0021` security-grant pattern holds for
  both new/renamed functions.
- `supabase/tests/stub_auth.sql` fakes just enough of Supabase's `auth`
  schema (an `auth.uid()` reading `app.current_user_id`, plus the
  `authenticated`/`anon`/`service_role` roles) for the real migrations to
  apply to a plain local Postgres. **Note the stub's session variable is
  `app.current_user_id`, not the real Supabase convention
  `request.jwt.claim.sub`** — don't mix them up when writing a test that
  simulates a logged-in user (`select set_config('app.current_user_id', '<uuid>', false);`).
- Before trusting any non-obvious Postgres/RLS mechanism (view ownership
  bypassing RLS, `NULLS NOT DISTINCT` semantics, ILIKE escaping,
  percent-encoding of route params), this project's discipline has been:
  reproduce it directly against a real engine first, then rely on it —
  several real bugs upstream were caused by skipping that step and
  assuming instead.

## Product judgment calls made along the way (all reversible, flagged as such when made)

- `contenu_debloque`/`evenement_live` feature flags default **on** (see
  `parametres_plateforme` above), unlike the other flags.
- **Reversed in `0009`:** "no public créateur directory" (the original
  call was that traffic would come only from a créateur sharing their own
  link) is no longer true — `/explorer` now exists, per explicit
  instruction, and visibility there defaults **on**: any créateur with an
  active offre is listed unless they opt out via `masque_exploration`.
  This is the opposite default direction from `classement_public` (opt-in)
  on purpose — the instruction that added it was explicit that exploration
  should default to visible. Because that default could surprise someone
  running a sensitive/low-profile use case (a pastor collecting church
  donations, say) without asking for exposure, `POST /api/offres`
  computes `isFirstOffre` (true iff the créateur had zero offres before
  this call — self-limiting without a persisted "already shown" flag,
  since offres are never deleted) and `OffresManager` shows a one-time
  dismissible notice on that first creation, linking to `/parametres`.
  Don't mistake this for a second "are you sure" gate — it's
  informational only, the offre is created either way; it just makes sure
  the default is never silent.
- Ranking leaderboards show rank only, nothing else, per an explicit
  instruction — no supporting counts/dates/amounts, even non-monetary
  ones.
- Profile photo upload deferred to post-signup `/parametres` rather than
  collected at signup, because it needs a presigned R2 URL which in turn
  needs an authenticated account that doesn't exist yet during signup.
