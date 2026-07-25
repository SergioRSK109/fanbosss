@AGENTS.md

# FanBoss — project state and design decisions

This section is a working reference for picking this project back up in a
new session without re-deriving context. It reflects the schema and code
as of migration `0015` plus the follow-up fixes after it. When it and the
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

Migrations are strictly incremental (`supabase/migrations/0001`...`0015`)
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
  cards) shares it.
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
constraint (most recently updated in `0015`) and `PSEUDO_MOTS_RESERVES`
in `src/lib/validation.ts` — update both if new top-level routes are
added): `dashboard, signup, login, api, auth, createur, mes-transactions,
paiement, parametres, explorer, mot-de-passe-oublie,
reinitialiser-mot-de-passe, admin`.

### `offres`
- `id uuid` PK, `createur_id uuid references users(id)`
- `type text` — `check (type in ('video','don','whatsapp','shoutout','contenu_debloque','evenement_live'))`
- `prix numeric` — **nullable**, but `offres_prix_required_unless_don`
  enforces non-null for every type except `don` (the fan picks the amount
  at payment time for `don`, so it never has a fixed price)
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
  reflected immediately for everyone who already paid)
- `libelle text` — **only meaningful for `video`**: a créateur can list
  several video offers distinguished by label ("Anniversaire" at 10$,
  "Danse" at 15$). Every other type leaves this null.
- `unique_offre_type_par_createur`: `unique NULLS NOT DISTINCT
  (createur_id, type, libelle)` — this is the mechanism that makes
  "one offre per type" hold for every type except `video`. **Do not
  simplify this to a plain UNIQUE constraint** — plain UNIQUE treats every
  NULL as distinct, so two whatsapp/don/etc. rows (both with
  `libelle = null`) would silently stop conflicting and a créateur could
  end up with duplicates of a type that's supposed to be exclusive.
  Verified this exact failure mode empirically before deciding on NULLS
  NOT DISTINCT (see git history on migration `0007`).

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
`montant_brut`, `commission_plateforme` (20% of brut),
`frais_agregateur` (3% of brut), `tva` (16% of commission),
`montant_net_createur`, `statut_paiement`
(`initie`→`reussi` on delivery, →`rembourse` on refund).

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
  `evenement_live`'s pre-payment secret link).
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
back and the external scheduler can be retired.

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
  refunds").
- `npm run test:sql` (`supabase/tests/run_sql_tests.sh` +
  `checklist_2_3.sql`): creates a throwaway Postgres database (via
  `sudo -u postgres psql`, **not** Docker — Docker's daemon isn't running
  in this sandbox), applies every migration in order, then asserts
  against real constraint violations/trigger behavior: whatsapp price
  floor (can't be bypassed via UPDATE or via `config`), both deadline-cron
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
  `remboursement_pourcentage` seed to their correct defaults.
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
