-- SLA tracking on disputed deliveries, per the 15-business-day commitment
-- in the CGU (article 6.3). transactions.created_at reflects the original
-- payment, not the dispute -- there was never a column recording *when*
-- a fan actually disputed a delivery, only confirme_at for the opposite
-- branch (migration 0025). Nullable: a litige disputed before this
-- migration shipped has no way to know when it actually happened and is
-- left null rather than backfilled with a guess -- see LitigesManager.tsx
-- for how the admin UI handles that gracefully (no urgency badge at all,
-- rather than a fabricated one).
alter table transactions add column conteste_at timestamptz;

-- create or replace with an identical signature -- leaves the existing
-- EXECUTE grant (authenticated only, migration 0025) untouched, same
-- precedent as migration 0034's own notification-wiring redefinition of
-- this exact function (preserved verbatim below, only the UPDATE gains
-- conteste_at = now() alongside confirmation_fan = 'conteste', in the
-- same statement so the two can never drift apart).
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
    set confirmation_fan = 'conteste', conteste_at = now()
    where id = p_transaction_id;

  perform creer_notification(v_tx.createur_id, 'contestation_recue', p_transaction_id, null, auth.uid());
end;
$$;
