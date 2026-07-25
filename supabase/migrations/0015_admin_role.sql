-- Business admin dashboard (/admin). users.est_admin gates access; the
-- real guarantee that a normal user can never grant themselves admin has
-- to live here, not just in application code -- users_update_self (RLS)
-- lets an authenticated user PATCH their own row's *any* column directly
-- via the Supabase REST API, exactly the same gap already closed for
-- pseudo_modifie_at in migration 0010. Same fix shape: a BEFORE UPDATE
-- trigger that silently forces est_admin back to its previous value
-- unless the caller is themselves already an admin.
alter table users add column est_admin boolean not null default false;

-- New top-level route (/admin) -- keep the reserved-pseudo list in sync,
-- same as every previous route addition (0008/0009/0013). See
-- src/lib/validation.ts#PSEUDO_MOTS_RESERVES.
alter table users drop constraint users_pseudo_not_reserved;
alter table users add constraint users_pseudo_not_reserved
  check (
    pseudo is null or lower(pseudo) not in (
      'dashboard', 'signup', 'login', 'api', 'auth',
      'createur', 'mes-transactions', 'paiement', 'parametres', 'explorer',
      'mot-de-passe-oublie', 'reinitialiser-mot-de-passe', 'admin'
    )
  );

create or replace function enforce_est_admin_change()
returns trigger
language plpgsql
as $$
begin
  if new.est_admin is distinct from old.est_admin then
    -- auth.uid() is null for anything that isn't a normal authenticated
    -- PostgREST request -- the SQL Editor, a service-role connection, or
    -- this migration itself. Those already have unrestricted DB access
    -- regardless of this trigger (a superuser can `alter table ... disable
    -- trigger` anyway), so exempting them isn't a new hole; it's what
    -- makes bootstrapping the very first admin a single plain UPDATE
    -- rather than a disable-trigger dance. Real authenticated requests
    -- through PostgREST always carry a non-null auth.uid() (their JWT's
    -- `sub` claim), so this exemption is never reachable by an ordinary
    -- user, malicious or not -- confirmed in checklist_2_3.sql.
    if auth.uid() is not null and not exists (
      select 1 from users where id = auth.uid() and est_admin = true
    ) then
      new.est_admin := old.est_admin;
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_enforce_est_admin_change
  before update on users
  for each row
  execute function enforce_est_admin_change();

-- Only a SECURITY DEFINER RPC can grant/revoke someone ELSE's admin
-- status: users_update_self's RLS policy is `id = auth.uid()`, so even a
-- genuine admin cannot UPDATE another user's row via a raw PATCH at all --
-- this RPC is the only sanctioned path, and it re-verifies the caller is
-- an admin itself (the trigger above re-checks this independently too,
-- defense in depth, same as accept_transaction/refuse_transaction
-- re-verifying ownership despite already being SECURITY DEFINER).
create or replace function set_admin_status(p_user_id uuid, p_est_admin boolean)
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

  update users set est_admin = p_est_admin where id = p_user_id;
end;
$$;

-- Marks a transaction's manual-refund worklist entry as handled once the
-- admin has actually issued the refund by hand via the CinetPay dashboard.
-- transactions has no authenticated-user UPDATE policy at all (see
-- CLAUDE.md), so this needs the same SECURITY DEFINER RPC pattern.
-- Deliberately does NOT touch reference_remboursement_cinetpay or
-- montant_rembourse -- those columns specifically mean "a real automated
-- CinetPay API call was confirmed" (src/lib/refunds.ts), which this isn't;
-- clearing necessite_remboursement_manuel alone is the accurate signal
-- for "handled outside the app, by a human."
create or replace function mark_remboursement_manuel_traite(p_transaction_id uuid)
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

  if not exists (
    select 1 from transactions
      where id = p_transaction_id and necessite_remboursement_manuel = true
  ) then
    raise exception 'transaction not found or already handled';
  end if;

  update transactions set necessite_remboursement_manuel = false
    where id = p_transaction_id;
end;
$$;
