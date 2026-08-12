-- Admin warning mechanism, plus the suspension/ban notifications missing
-- from the previous lot (migration 0052 built the block itself, but
-- never told the affected user via the in-app notification system
-- already established in migration 0034 -- see CLAUDE.md's own section
-- on why that was a real gap, not a deliberate scope limit).

-- ---------------------------------------------------------------------
-- 1. Schema: a new table, not a statut_compte state -- see CLAUDE.md for
--    why. In short: a warning never blocks access (statut_compte would
--    have to grow a fourth, non-blocking value and every view/layout
--    check from migration 0052 would need to special-case it back out),
--    and a user can accumulate several warnings over time while staying
--    fully active -- statut_compte is a single current state, not a log.
-- ---------------------------------------------------------------------

create table avertissements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  raison text not null,
  emis_par uuid not null references users(id),
  emis_at timestamptz not null default now(),
  vu_at timestamptz
);
create index idx_avertissements_user on avertissements(user_id, emis_at desc);

-- Self-only reads, no INSERT/UPDATE/DELETE policy for authenticated at
-- all -- same "state machine only via a vetted RPC" shape as every other
-- user-owned table in this project (transactions, publications,
-- demandes_verification, notifications...). The admin history in
-- "Gestion des comptes" reads via the service-role client, same
-- established pattern as every other admin worklist.
alter table avertissements enable row level security;
create policy avertissements_select_own on avertissements
  for select using (user_id = auth.uid());

-- notifications.type gains three more values -- verified the real
-- constraint name (notifications_type_check, Postgres's own default
-- naming for an inline column CHECK) against a throwaway database before
-- assuming it, per this project's standing discipline, rather than
-- guessing at a name never actually confirmed.
alter table notifications drop constraint notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in (
    'demande_recue', 'don_recu',
    'demande_acceptee', 'demande_refusee', 'video_livree',
    'confirmation_recue', 'contestation_recue',
    'litige_tranche_createur', 'litige_tranche_fan',
    'retrait_traite', 'retrait_refuse',
    'publication_aimee',
    'avertissement_recu', 'compte_suspendu', 'compte_banni'
  ));

-- ---------------------------------------------------------------------
-- 2. emettre_avertissement(p_user_id, p_raison) -- admin-only, same
--    est_admin re-check shape as every other admin RPC since migration
--    0015. Unlike statut_compte_raison (nullable, migration 0052) --
--    a warning IS its reason, so a blank one would be a warning about
--    nothing; rejected both by the column's own NOT NULL and, for a
--    friendlier message than a raw constraint violation, by an explicit
--    check here first (whitespace-only counts as blank too, which NOT
--    NULL alone wouldn't catch).
-- ---------------------------------------------------------------------

create or replace function emettre_avertissement(p_user_id uuid, p_raison text)
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

  if p_raison is null or trim(p_raison) = '' then
    raise exception 'raison is required';
  end if;

  if not exists (select 1 from users where id = p_user_id) then
    raise exception 'user not found';
  end if;

  insert into avertissements (user_id, raison, emis_par)
    values (p_user_id, p_raison, auth.uid());

  -- Same "call from inside an already-elevated SECURITY DEFINER
  -- context" mechanism creer_notification()'s own every other caller
  -- already relies on (migration 0034) -- no separate grant needed here.
  perform creer_notification(p_user_id, 'avertissement_recu', null, null, auth.uid());
end;
$$;

revoke all on function emettre_avertissement(uuid, text) from public;
grant execute on function emettre_avertissement(uuid, text) to authenticated;

-- marquer_avertissement_vu(p_avertissement_id) -- self-only. The
-- "not exists ... and user_id = auth.uid() and vu_at is null" guard does
-- three jobs at once, same "not found or already handled" idiom as
-- every other admin/state RPC in this project: a genuinely unknown id,
-- someone else's avertissement (never leaks whether it exists for
-- another user -- the error is identical either way), and an
-- already-seen one are all rejected with the same message, never a
-- silent no-op.
create or replace function marquer_avertissement_vu(p_avertissement_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1 from avertissements
      where id = p_avertissement_id and user_id = auth.uid() and vu_at is null
  ) then
    raise exception 'avertissement not found or already vu';
  end if;

  update avertissements set vu_at = now() where id = p_avertissement_id;
end;
$$;

revoke all on function marquer_avertissement_vu(uuid) from public;
grant execute on function marquer_avertissement_vu(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. appliquer_statut_compte() (migration 0052) extended with the one
--    notification call it was missing -- same identical signature
--    (create or replace), so suspendre_compte()/bannir_compte() need no
--    change of their own at all: they already `perform
--    appliquer_statut_compte(...)`, and this is the single shared place
--    every one of that helper's side effects already lives, per its own
--    original design ("offres deactivated, publications masked,
--    transactions refunded -- all inside the one call"). Placed last,
--    after every other side effect, matching that same order.
-- ---------------------------------------------------------------------

create or replace function appliquer_statut_compte(p_user_id uuid, p_statut text, p_raison text)
returns void
language plpgsql
as $$
begin
  if not exists (
    select 1 from users where id = p_user_id and statut_compte is distinct from p_statut
  ) then
    raise exception 'user not found or already %', p_statut;
  end if;

  update users
    set statut_compte = p_statut,
        statut_compte_raison = p_raison,
        statut_compte_change_par = auth.uid(),
        statut_compte_change_at = now()
    where id = p_user_id;

  update offres set actif = false where createur_id = p_user_id and actif = true;

  update publications set masque = true where auteur_id = p_user_id and masque = false;

  update transactions set statut = 'remboursee'
    where createur_id = p_user_id and statut in ('en_attente', 'validee');

  -- The gap this migration closes: migration 0052 never told the
  -- affected user via the notification system, even though it already
  -- existed (migration 0034) and every other state-changing admin RPC
  -- in this project wires one in. p_statut is only ever 'suspendu' or
  -- 'banni' here -- reactiver_compte_admin() doesn't call this helper at
  -- all (see its own section) and there is deliberately no
  -- 'compte_reactive' notification type.
  perform creer_notification(
    p_user_id,
    case when p_statut = 'suspendu' then 'compte_suspendu' else 'compte_banni' end,
    null, null, auth.uid()
  );
end;
$$;

revoke all on function appliquer_statut_compte(uuid, text, text) from public;
