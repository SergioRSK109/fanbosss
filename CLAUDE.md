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

## Database schema (current, post-migration 0011)

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
constraint (most recently updated in `0019`) and `PSEUDO_MOTS_RESERVES`
in `src/lib/validation.ts` — update both if new top-level routes are
added): `dashboard, signup, login, api, auth, createur, mes-transactions,
paiement, parametres, explorer, mot-de-passe-oublie,
reinitialiser-mot-de-passe, admin, classement`.

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
rather than silently skipping half the sweep.

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

**2. `/classement` — public leaderboard page (no auth required).** Three
sections (Top 10 volume/réactivité/progression), each reading straight
from the existing public `classement_volume`/`classement_reactivite`/
`classement_progression` views (`rang <= 10`, ordered by `rang`) plus
`profils_publics` for the display bits (photo/pseudo/nom_affichage) —
the exact same public view `/explorer` and `/@pseudo` already read from.
`src/lib/classementPublic.ts#getClassementPublicData()` is the only
place this page queries from; it never touches `users`/`transactions`
directly and never selects a column beyond `createur_id, rang` from the
classement views or the four display columns from `profils_publics` —
asserted directly in `classementPublic.test.ts` by spying on every
`.from()`/`.select()` call, the same "prove the view/query never
leaks more than it should" discipline this codebase already applies to
`profils_explorables` (via SQL) — here via a mocked Supabase client
instead, since the property being proven is about this page's own query
shape, not a database view. Cards link to `/@pseudo` when set, else
`/createur/[id]`, same fallback as `/explorer`'s cards.

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
'logout' bug" section above): `/classement` renders three populated
sections with photo/name/rank and correct `/@pseudo` links, and the
dashboard's new progress card renders three progress bars with the
expected French copy and fill percentages computed from a fixed
`mes_progres_classement()` fixture (e.g. "Plus que 3 transactions livrées
pour entrer dans le top 10 volume ce mois-ci" at a 4-of-7 fill).

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
button (`Soutiens-moi sur FanBoss 👉 {origin}/@{pseudo}`), shown on the
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
dashboard's "Paiements envoyés à d'autres créateurs" list previously
showed a short human label (`en attente de réponse du créateur`) but no
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

Fully translated (fr+en) — the pages a foreign visitor hits first: home,
signup, login, créateur/paiement profile page, payment-return page,
explorer. **Dashboard and `/parametres` stay French-only for now**, by design
(lower priority for this MVP) — adding their keys to
`messages/{fr,en}.json` later needs no structural change. Internal
navigation must use the locale-aware `Link`/`redirect`/`useRouter` from
`src/i18n/navigation.ts`, never plain `next/link`/`next/navigation` — a
few redirects (`/dashboard`, `/parametres` → `/login`) needed an explicit
`return;` after the redirect call for TypeScript to narrow correctly
afterward (the locale-aware `redirect`'s `never` return type doesn't
always get picked up by control-flow analysis the same way `next/navigation`'s did).

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
  `classement_progression`/`profils_publics`, never `users`/`transactions`
  directly, and that it selects exactly `createur_id, rang` from the
  classement views and exactly the four public display columns from
  `profils_publics` — never a count or amount).
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
  covers `users_date_naissance_majorite` (0016) with real insertion
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
  exception. Also covers the `'classement'` reserved pseudo (0019).
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
