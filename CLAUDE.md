@AGENTS.md

# FanBoss — project state and design decisions

This section is a working reference for picking this project back up in a
new session without re-deriving context. It reflects the schema and code
as of migration `0010` plus the follow-up fixes after it. When it and the
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

## Database schema (current, post-migration 0010)

Migrations are strictly incremental (`supabase/migrations/0001`...`0010`)
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
- `bio text` — max 500 chars (`users_bio_max_length`), collected at
  signup (optional) or edited later
- `photo_r2_key text` — nullable; only ever settable through the
  authenticated upload flow (`/api/profil/photo-upload-url` → PUT to R2 →
  PATCH `/api/profil`), **never collected at signup** (no authenticated
  session yet at that point to key an R2 object against)
- `lien_reseau_social text` — TikTok/Instagram/etc. link, collected at
  signup (optional) or edited later, `zod .url()` validated at the API
  layer
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

Reserved pseudo words (kept in sync in **two** places — the DB CHECK
constraint in `0009` and `PSEUDO_MOTS_RESERVES` in `src/lib/validation.ts`
— update both if new top-level routes are added):
`dashboard, signup, login, api, auth, createur, mes-transactions,
paiement, parametres, explorer`.

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

### `reports`
`reporter_id`, `reported_user_id`, `type` (`signalement`/`blocage`),
`raison`, `statut`.

### Public views (never expose the raw tables for cross-user reads)
- `profils_publics`: `id, pays, devise, date_creation, pseudo, bio,
  photo_r2_key, lien_reseau_social, nom_affichage` — deliberately
  excludes `telephone` and (transitively, since it's a separate table)
  any monetary data.
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

Profile photo: clicking the photo **zooms it** (a simple `position:
fixed` overlay, click-outside or ✕ to close) rather than opening the file
picker — that used to be the accidental behavior, because the `<img>` sat
inside the same `<label>` as the file `<input>`, and clicking anywhere in
a label associated with a control activates that control. Fixed by
pulling the file input out into its own hidden (`className="hidden"`)
element, triggered only by a separate "Modifier la photo de profil"
button via `fileInputRef.current?.click()`.

## i18n (next-intl)

Locales `fr` (default, unprefixed) / `en` (prefixed `/en`),
`localePrefix: "as-needed"`. All pages live under `src/app/[locale]/...`;
`src/app/api/**` and `src/app/auth/callback` are deliberately **outside**
`[locale]` (they're not pages; a next-intl rewrite over them would 404).
`src/proxy.ts` composes next-intl's middleware with the Supabase session
refresh — the refreshed cookies are written onto the *same* response
object next-intl produced (redirect/rewrite/pass-through), not a fresh
one. Root `src/app/layout.tsx` is a bare passthrough (`return children`);
the real `<html>`/`<body>`/`NextIntlClientProvider` live in
`src/app/[locale]/layout.tsx`.

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

## Testing

- `npm test` (Vitest): HMAC verification, webhook handler branching
  (don/contenu_debloque/evenement_live → immediate validation, video →
  not), signed-URL delivery routes (auth/ownership/status checks before
  minting a URL), the `[handle]` route's percent-decoding, zod schemas.
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
  length constraint, `'explorer'` landing in the reserved-pseudo list,
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
  describing new DB behavior in prose.**
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
