-- Row Level Security. The service role (used by webhooks and the cron
-- route) bypasses RLS entirely, which is intentional: those paths run
-- server-side with a secret never exposed to the browser.

alter table users enable row level security;
alter table offres enable row level security;
alter table transactions enable row level security;
alter table paiements enable row level security;
alter table parrainages enable row level security;
alter table parametres_plateforme enable row level security;
alter table reports enable row level security;

-- users -----------------------------------------------------------------
create policy users_select_self on users
  for select using (id = auth.uid());

create policy users_select_public_creator_profile on users
  for select using (role in ('createur', 'both'));

create policy users_update_self on users
  for update using (id = auth.uid());

create policy users_insert_self on users
  for insert with check (id = auth.uid());

-- offres ------------------------------------------------------------------
create policy offres_select_active_public on offres
  for select using (actif = true);

create policy offres_select_own on offres
  for select using (createur_id = auth.uid());

create policy offres_insert_own on offres
  for insert with check (createur_id = auth.uid());

create policy offres_update_own on offres
  for update using (createur_id = auth.uid());

create policy offres_delete_own on offres
  for delete using (createur_id = auth.uid());

-- transactions --------------------------------------------------------------
-- No direct UPDATE policy for authenticated users: all state transitions go
-- through the SECURITY DEFINER RPCs (accept_transaction, refuse_transaction,
-- deliver_video) so the state machine and its deadlines cannot be bypassed
-- by writing to the table directly.
create policy transactions_select_fan on transactions
  for select using (fan_id = auth.uid());

create policy transactions_select_createur on transactions
  for select using (createur_id = auth.uid());

create policy transactions_insert_fan on transactions
  for insert with check (fan_id = auth.uid());

-- paiements -----------------------------------------------------------------
create policy paiements_select_createur on paiements
  for select using (
    exists (
      select 1 from transactions t
      where t.id = paiements.transaction_id and t.createur_id = auth.uid()
    )
  );

-- parrainages -----------------------------------------------------------------
create policy parrainages_select_own on parrainages
  for select using (parrain_id = auth.uid());

-- parametres_plateforme -------------------------------------------------------
-- Readable by anyone (feature flags gate client behavior); writable only by
-- the service role (no insert/update/delete policy granted here).
create policy parametres_plateforme_select_all on parametres_plateforme
  for select using (true);

-- reports -----------------------------------------------------------------
create policy reports_insert_own on reports
  for insert with check (reporter_id = auth.uid());

create policy reports_select_own on reports
  for select using (reporter_id = auth.uid());

grant execute on function accept_transaction(uuid) to authenticated;
grant execute on function refuse_transaction(uuid) to authenticated;
grant execute on function deliver_video(uuid, text) to authenticated;
