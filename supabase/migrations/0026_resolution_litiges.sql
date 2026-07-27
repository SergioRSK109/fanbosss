-- Lot 2a-bis -- admin resolution for the "Litiges en attente" worklist
-- (migration 0025 left this deliberately read-only). Same scope as
-- before: only ever meaningful for a transaction whose confirmation_fan
-- is 'conteste', which in practice only ever happens for video/shoutout
-- -- no separate type check is needed here for the same reason
-- confirmer_livraison_fan/contester_livraison_fan don't have one either.

-- Traceability of the admin's decision -- who resolved it, when, which
-- way, and an optional free-text note (e.g. "vidéo hors-sujet, remboursé"
-- or "vidéo conforme, litige non fondé").
alter table transactions add column litige_resolution text
  check (litige_resolution in ('faveur_createur', 'faveur_fan'));
alter table transactions add column litige_resolu_par uuid references users(id);
alter table transactions add column litige_resolu_at timestamptz;
alter table transactions add column litige_note_admin text;

-- Deliberately reuses the existing 'confirme' state for a
-- faveur_createur decision, rather than introducing a new
-- confirmation_fan value (e.g. 'confirme_par_admin') -- a litige decided
-- in the créateur's favor should become withdrawable exactly like a
-- normal fan confirmation, with zero special-casing anywhere that reads
-- confirmation_fan (in particular, Lot 2b's wallet/withdrawal
-- calculation should never need to know *why* a transaction reached
-- 'confirme'). litige_resolution/litige_resolu_par/litige_resolu_at are
-- what preserve the distinction for auditing -- confirmation_fan alone
-- deliberately doesn't.
--
-- Same SECURITY DEFINER discipline as every admin RPC in this project
-- (mark_remboursement_manuel_traite, set_admin_status, migration 0015):
-- re-verifies est_admin internally (not just trusting the caller was
-- already checked client-side), revoke all from public + grant to
-- authenticated only.
create or replace function resoudre_litige(
  p_transaction_id uuid,
  p_decision text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from users where id = auth.uid() and est_admin = true
  ) then
    raise exception 'not authorized';
  end if;

  if p_decision not in ('faveur_createur', 'faveur_fan') then
    raise exception 'invalid decision: %', p_decision;
  end if;

  if not exists (
    select 1 from transactions
      where id = p_transaction_id
        and confirmation_fan = 'conteste'
        and litige_resolu_at is null
  ) then
    raise exception 'transaction not found or already resolved';
  end if;

  update transactions
    set litige_resolution = p_decision,
        litige_resolu_par = auth.uid(),
        litige_resolu_at = now(),
        litige_note_admin = p_note,
        confirmation_fan = case when p_decision = 'faveur_createur' then 'confirme' else confirmation_fan end,
        confirme_at = case when p_decision = 'faveur_createur' then now() else confirme_at end,
        statut = case when p_decision = 'faveur_fan' then 'remboursee' else statut end
    where id = p_transaction_id;
end;
$$;

revoke all on function resoudre_litige(uuid, text, text) from public;
grant execute on function resoudre_litige(uuid, text, text) to authenticated;
