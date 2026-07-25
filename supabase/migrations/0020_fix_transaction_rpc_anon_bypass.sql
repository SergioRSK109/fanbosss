-- Real, currently-exploitable vulnerability, reproduced empirically
-- against a real Postgres instance before writing this fix (same
-- discipline as the logo-click "logout" investigation and the
-- pseudo-cooldown/admin-escalation RLS-bypass gaps already documented in
-- CLAUDE.md): an entirely anonymous, unauthenticated caller could accept,
-- refuse, or fake-deliver ANY créateur's transaction.
--
-- Two independent problems, both in accept_transaction/refuse_transaction
-- (migration 0002, redefined in 0008) and deliver_video (migration 0002,
-- redefined in 0006):
--
-- 1. `if v_tx.createur_id != auth.uid() then raise 'not authorized'` --
--    `!=` with a NULL operand evaluates to NULL, never TRUE, and an `IF`
--    treats NULL the same as FALSE. So whenever auth.uid() was NULL (no
--    session at all), this "authorization" check silently did nothing.
--    Reproduced directly: `SET ROLE anon;` (no app.current_user_id set
--    at all, simulating a fully anonymous request) followed by
--    `select accept_transaction('<a real pending transaction belonging
--    to a different, real créateur>')` genuinely flipped it to
--    'validee' and set repondu_at. Same result for refuse_transaction
--    (-> 'remboursee') and deliver_video, which is worse still: it let
--    an anonymous caller write an attacker-chosen r2_key into
--    `livrable`, which would then be served to the paying fan as the
--    créateur's real delivered video.
-- 2. None of these three functions ever had EXECUTE revoked from
--    `public`. Postgres grants EXECUTE to PUBLIC by default on newly
--    created functions (unlike tables, which default to no access) --
--    migration 0003's `grant execute ... to authenticated` was additive,
--    never a replacement, and `anon` inherits PUBLIC. Confirmed
--    directly: `select has_function_privilege('anon',
--    'accept_transaction(uuid)', 'EXECUTE')` returned `true` before this
--    migration. `mes_progres_classement()` (migration 0019) already got
--    this right (`revoke all ... from public`); these three predate that
--    pattern.
--
-- Fix, both layers: an explicit `auth.uid() is null` rejection up front
-- (same style as mes_progres_classement, and a clean, specific error
-- instead of a confusing generic one) *and* `is distinct from` instead
-- of `!=` for the ownership comparison itself -- correct regardless of
-- which side is NULL, and still correct even if the explicit check above
-- were ever accidentally removed later. Plus revoking EXECUTE from
-- public on all three and re-granting only to `authenticated`, exactly
-- like migration 0019.

create or replace function accept_transaction(p_transaction_id uuid)
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

  if v_tx.statut != 'en_attente' then
    raise exception 'transaction is not pending acceptance';
  end if;

  if v_tx.deadline_acceptation is not null and now() > v_tx.deadline_acceptation then
    raise exception 'acceptation deadline has passed';
  end if;

  select type into v_offre_type from offres where id = v_tx.offre_id;

  update transactions set statut = 'validee', repondu_at = now() where id = p_transaction_id;

  -- WhatsApp: l'acceptation EST la livraison (numéro révélé immédiatement).
  if v_offre_type = 'whatsapp' then
    update transactions set statut = 'livree' where id = p_transaction_id;
  end if;
end;
$$;

create or replace function refuse_transaction(p_transaction_id uuid)
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

  if v_tx.createur_id is distinct from auth.uid() then
    raise exception 'not authorized';
  end if;

  if v_tx.statut != 'en_attente' then
    raise exception 'transaction is not pending acceptance';
  end if;

  update transactions set statut = 'remboursee', repondu_at = now() where id = p_transaction_id;
end;
$$;

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
    set statut = 'livree', livrable = jsonb_build_object('r2_key', p_r2_key)
    where id = p_transaction_id;
end;
$$;

revoke all on function accept_transaction(uuid) from public;
revoke all on function refuse_transaction(uuid) from public;
revoke all on function deliver_video(uuid, text) from public;

grant execute on function accept_transaction(uuid) to authenticated;
grant execute on function refuse_transaction(uuid) to authenticated;
grant execute on function deliver_video(uuid, text) to authenticated;
