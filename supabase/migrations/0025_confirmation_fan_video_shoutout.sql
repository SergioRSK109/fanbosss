-- Lot 2a -- fan confirmation state for delivered video/shoutout offers
-- ONLY. Explicit scope reminder (per the brief that introduced this,
-- kept here so a future migration doesn't silently extend it): this
-- mechanism applies exclusively to `video`/`shoutout` -- the only two
-- types where the créateur delivers a personalized, judgeable piece of
-- content. `don`, `evenement_live`, `whatsapp`, `contenu_debloque`, and
-- `campagne` are all untouched by this migration -- they keep reaching
-- and leaving `livree` exactly as before, and `confirmation_fan` stays
-- `'non_applicable'` for every one of them, forever (there is no code
-- path anywhere that flips it to anything else for a non-video/shoutout
-- transaction -- see deliver_video() below, the only writer of
-- `'en_attente'`).
--
-- What "l'argent reste gelé" actually means here, stated plainly rather
-- than implied: this app has no "release funds to créateur" step at all
-- yet (money movement automation only exists for fan-side refunds, see
-- migration 0014's CinetPay stub) -- handle_transaction_livraison()
-- already marks `paiements.statut_paiement = 'reussi'` the instant
-- `deliver_video()` sets `statut = 'livree'`, in the same UPDATE, exactly
-- as it did before this migration. A dispute does not (and, without
-- touching that trigger, cannot) reverse that bookkeeping flag -- what it
-- actually does is: raise a visible flag for a human to review
-- (`confirmation_fan = 'conteste'`, surfaced in a new admin worklist
-- section), and *not* auto-confirm the transaction the way silence would.
-- No refund is attempted automatically, on purpose (item 3) -- exactly
-- like a créateur-verification conflict, this sits until a human looks
-- at it; see CLAUDE.md for the full reasoning.
alter table transactions add column confirmation_fan text
  check (confirmation_fan in ('non_applicable', 'en_attente', 'confirme', 'conteste'))
  not null default 'non_applicable';
alter table transactions add column deadline_confirmation timestamptz;
alter table transactions add column confirme_at timestamptz;

-- deliver_video() (migration 0002, security-hardened in 0020) now also
-- opens the 72h confirmation window the moment it delivers a video/
-- shoutout. Nothing else in this function changes -- same auth.uid()
-- checks, same ownership/type/deadline guards, same EXECUTE grant
-- (authenticated only, unchanged from 0020 -- `create or replace` with
-- an identical signature leaves existing grants untouched, so they don't
-- need to be re-stated here).
create or replace function deliver_video(p_transaction_id uuid, p_r2_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx record;
  v_offre_type text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into v_tx from transactions where id = p_transaction_id for update;

  if v_tx is null then
    raise exception 'transaction not found';
  end if;

  if v_tx.createur_id is distinct from auth.uid() then
    raise exception 'not authorized';
  end if;

  select type into v_offre_type from offres where id = v_tx.offre_id;
  if v_offre_type not in ('video', 'shoutout') then
    raise exception 'only video/shoutout offers are delivered via this function';
  end if;

  if v_tx.statut != 'validee' then
    raise exception 'transaction has not been accepted yet';
  end if;

  if v_tx.deadline_livraison is not null and now() > v_tx.deadline_livraison then
    raise exception 'delivery deadline has passed';
  end if;

  update transactions
    set statut = 'livree',
        livrable = jsonb_build_object('r2_key', p_r2_key),
        confirmation_fan = 'en_attente',
        deadline_confirmation = now() + interval '72 hours'
    where id = p_transaction_id;
end;
$$;

-- Two new fan-facing RPCs, same SECURITY DEFINER discipline as every
-- transaction-state-machine function in this project since the migration
-- 0020 fix: an explicit `auth.uid() is null` rejection up front, `is
-- distinct from` (never `!=`) for the ownership comparison, and EXECUTE
-- revoked from public + granted only to authenticated -- never anon,
-- never left on the Postgres default.
--
-- Both share the same eligibility guard: `statut = 'livree' and
-- confirmation_fan = 'en_attente'`. This is what makes the mechanism's
-- scope self-enforcing at the function level, not just by convention --
-- calling either RPC on a whatsapp/don/etc. transaction (confirmation_fan
-- stuck at 'non_applicable' forever) or on one already confirmed/disputed
-- always raises, never silently no-ops.
create or replace function confirmer_livraison_fan(p_transaction_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx record;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into v_tx from transactions where id = p_transaction_id for update;

  if v_tx is null then
    raise exception 'transaction not found';
  end if;

  if v_tx.fan_id is distinct from auth.uid() then
    raise exception 'not authorized';
  end if;

  if v_tx.statut != 'livree' or v_tx.confirmation_fan != 'en_attente' then
    raise exception 'transaction is not awaiting fan confirmation';
  end if;

  update transactions
    set confirmation_fan = 'confirme', confirme_at = now()
    where id = p_transaction_id;
end;
$$;

-- Deliberately does NOT touch `statut` (stays 'livree') or
-- `necessite_remboursement_manuel` (that flag specifically means "a
-- refund already happened and needs the real CinetPay follow-through" --
-- a dispute hasn't concluded a refund is even warranted yet, so setting
-- it here would misrepresent what actually happened, same principle
-- mark_remboursement_manuel_traite() already follows). This function's
-- entire effect is the flag flip below -- no money moves, on purpose.
create or replace function contester_livraison_fan(p_transaction_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx record;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into v_tx from transactions where id = p_transaction_id for update;

  if v_tx is null then
    raise exception 'transaction not found';
  end if;

  if v_tx.fan_id is distinct from auth.uid() then
    raise exception 'not authorized';
  end if;

  if v_tx.statut != 'livree' or v_tx.confirmation_fan != 'en_attente' then
    raise exception 'transaction is not awaiting fan confirmation';
  end if;

  update transactions
    set confirmation_fan = 'conteste'
    where id = p_transaction_id;
end;
$$;

revoke all on function confirmer_livraison_fan(uuid) from public;
revoke all on function contester_livraison_fan(uuid) from public;
grant execute on function confirmer_livraison_fan(uuid) to authenticated;
grant execute on function contester_livraison_fan(uuid) to authenticated;

-- Auto-confirmation sweep: fan silence for 72h after delivery = satisfied
-- by default (item 4). Kept as its own function rather than folded into
-- process_transaction_deadlines() -- that function's only caller
-- (/api/cron/check-deadlines) loops over every row it returns and calls
-- processAutomaticRefund() for each one, since every case it has ever
-- handled ends in `statut = 'remboursee'`. An auto-confirmed transaction
-- never changes `statut` at all (already 'livree', stays 'livree') --
-- folding it into that shared return channel would need either a new
-- discriminator column or rely on processAutomaticRefund()'s own
-- re-read-and-no-op behavior for a non-'remboursee' row, both more
-- confusing than a second, clearly-named function. Same precedent as
-- close_expired_campagnes() (migration 0017), which rides this same
-- hourly external-cron infrastructure as its own second RPC call rather
-- than being merged into process_transaction_deadlines() either.
--
-- service_role only, same pattern as process_transaction_deadlines()/
-- close_expired_campagnes() (migration 0021's audit): this is a global
-- sweep with no per-caller scoping at all, so no authenticated user or
-- anon caller has any legitimate reason to invoke it directly -- only
-- the cron route, via the service-role client.
create or replace function process_confirmation_deadlines()
returns table(transaction_id uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update transactions
    set confirmation_fan = 'confirme', confirme_at = now()
    where confirmation_fan = 'en_attente'
      and deadline_confirmation is not null
      and deadline_confirmation < now()
    returning id;
end;
$$;

revoke all on function process_confirmation_deadlines() from public;
grant execute on function process_confirmation_deadlines() to service_role;
