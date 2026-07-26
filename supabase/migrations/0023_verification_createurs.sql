-- Two-tier créateur verification. Palier 1 (this migration): a free,
-- self-serve "add this code to your bio" check, admin-reviewed. Palier 2
-- (structure only, no real integration -- see CLAUDE.md "Créateur
-- verification" for the full account of what was searched and why no
-- automated video/deepfake check or KYC API call was built): a conflict
-- (two different créateurs claiming the same display name) is flagged
-- for manual review, never auto-resolved.

alter table users add column createur_verifie boolean not null default false;

create table demandes_verification (
  id uuid primary key default gen_random_uuid(),
  createur_id uuid not null references users(id),
  plateforme text not null check (plateforme in ('tiktok', 'instagram', 'youtube')),
  lien_compte text not null,
  code_verification text not null,
  statut text not null default 'en_attente'
    check (statut in ('en_attente', 'conflit', 'approuve', 'refuse')),
  created_at timestamptz not null default now(),
  traite_par uuid references users(id),
  traite_at timestamptz
);

alter table demandes_verification enable row level security;

-- Self-only reads (a créateur checking their own request's status/code).
-- Deliberately no insert/update policy for authenticated users at all --
-- every state transition (creation with its conflict check, approval,
-- refusal) goes through a SECURITY DEFINER RPC below, exactly the same
-- "no direct table write, state machine only via RPC" pattern already
-- used for `transactions` (see accept_transaction/refuse_transaction).
-- The admin listing reads via the service-role client (bypasses RLS),
-- same established pattern as every other admin page query.
create policy demandes_verification_select_own on demandes_verification
  for select using (createur_id = auth.uid());

-- unaccent ships with Postgres core contrib and is enabled by default in
-- Supabase projects -- needed for the "accents retirés" part of the
-- conflict-detection normalization below.
create extension if not exists unaccent;

-- Pure string transform, no table access -- safe with default grants
-- (nothing privileged to protect here, unlike the functions below).
create or replace function normaliser_nom_affichage(p_nom text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(unaccent(trim(coalesce(p_nom, ''))), '\s+', ' ', 'g'));
$$;

create or replace function generer_code_verification()
returns text
language plpgsql
as $$
declare
  v_chars text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  v_code text := '';
  i int;
begin
  for i in 1..10 loop
    v_code := v_code || substr(v_chars, floor(random() * length(v_chars) + 1)::int, 1);
  end loop;
  return 'FanBoss-' || v_code;
end;
$$;

-- Creates a verification request, deciding its initial statut atomically
-- with the conflict check -- this can't be a plain client-side INSERT
-- (no insert policy exists for authenticated users on this table at all)
-- specifically because the conflict check needs to read OTHER créateurs'
-- nom_affichage and their own pending/approved requests, which RLS would
-- otherwise block a plain authenticated caller from seeing.
--
-- Same shape as every other "must be self-only, needs elevated read
-- access to compute" RPC in this codebase (mes_progres_classement,
-- accept_transaction post-migration-0020): no target-createur parameter
-- at all, reads auth.uid() internally, raises if null, and EXECUTE is
-- revoked from public / granted only to authenticated below -- the
-- pattern the accept_transaction/refuse_transaction/deliver_video bypass
-- (migration 0020) got wrong, deliberately not repeated here.
--
-- Conflict detection deliberately compares LIVE nom_affichage (via a
-- join to `users`, not a snapshotted column on this table) -- same
-- "never store what's derivable live" principle already applied to
-- campagnes_montant_collecte and badges_fidelite_publics.depuis. A
-- créateur's claimed identity is their current public display name, and
-- storing a second, potentially-stale copy of it here would be exactly
-- the kind of drift-prone duplication this codebase avoids elsewhere.
create or replace function creer_demande_verification(p_plateforme text, p_lien_compte text)
returns table (id uuid, code_verification text, statut text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_nom_affichage text;
  v_nom_normalise text;
  v_code text;
  v_conflicting_ids uuid[];
  v_new_id uuid;
  v_new_statut text;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  if p_plateforme not in ('tiktok', 'instagram', 'youtube') then
    raise exception 'invalid plateforme';
  end if;

  select u.nom_affichage into v_nom_affichage from users u where u.id = v_user_id;
  if v_nom_affichage is null or trim(v_nom_affichage) = '' then
    raise exception 'nom_affichage is required before requesting verification';
  end if;

  v_nom_normalise := normaliser_nom_affichage(v_nom_affichage);

  -- Every OTHER créateur whose current nom_affichage normalizes to the
  -- same value and who already has a pending or approved request.
  select array_agg(distinct dv.createur_id) into v_conflicting_ids
    from demandes_verification dv
    join users u on u.id = dv.createur_id
    where dv.createur_id != v_user_id
      and dv.statut in ('en_attente', 'approuve')
      and normaliser_nom_affichage(u.nom_affichage) = v_nom_normalise;

  v_code := generer_code_verification();

  if v_conflicting_ids is not null and array_length(v_conflicting_ids, 1) > 0 then
    v_new_statut := 'conflit';
    -- Only flip the OTHER side's still-pending requests -- an already
    -- approved (already badged) request is never silently reverted by
    -- this automated check alone; that would be exactly the kind of
    -- unreviewed automated decision palier 2 explicitly avoids. See
    -- CLAUDE.md.
    -- Table-qualified on both sides of the WHERE clause: this function's
    -- OUT parameters (id, code_verification, statut) are also in scope
    -- as plain PL/pgSQL variable names here, and an unqualified `statut`
    -- was found (empirically, not assumed) to resolve ambiguously
    -- against the OUT parameter instead of the column -- Postgres raises
    -- "column reference is ambiguous" rather than silently picking one.
    update demandes_verification
      set statut = 'conflit'
      where demandes_verification.createur_id = any(v_conflicting_ids)
        and demandes_verification.statut = 'en_attente';
  else
    v_new_statut := 'en_attente';
  end if;

  insert into demandes_verification (createur_id, plateforme, lien_compte, code_verification, statut)
  values (v_user_id, p_plateforme, p_lien_compte, v_code, v_new_statut)
  returning demandes_verification.id into v_new_id;

  return query select v_new_id, v_code, v_new_statut;
end;
$$;

revoke all on function creer_demande_verification(text, text) from public;
grant execute on function creer_demande_verification(text, text) to authenticated;

-- Approve/refuse: same admin-only shape as set_admin_status/
-- mark_remboursement_manuel_traite (migration 0015) -- re-verifies
-- est_admin internally, EXECUTE revoked from public and granted only to
-- authenticated (never anon -- an admin action always requires a real
-- session). Approving a 'conflit' row is deliberately still allowed: the
-- whole point of palier 2 is that a HUMAN admin, having manually looked
-- into both conflicting accounts (outside this app, since no automated
-- KYC integration exists -- see CLAUDE.md), is the actual "manual
-- resolution" the conflict is waiting for. This function does not
-- auto-touch the OTHER conflicting request in any way -- an admin
-- resolving one side is not evidence the other is fraudulent.
create or replace function approuver_verification(p_demande_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_demande record;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not exists (select 1 from users where id = auth.uid() and est_admin = true) then
    raise exception 'not authorized';
  end if;

  select * into v_demande from demandes_verification where id = p_demande_id for update;
  if v_demande is null then
    raise exception 'demande not found';
  end if;
  if v_demande.statut in ('approuve', 'refuse') then
    raise exception 'demande already processed';
  end if;

  update demandes_verification
    set statut = 'approuve', traite_par = auth.uid(), traite_at = now()
    where id = p_demande_id;

  update users set createur_verifie = true where id = v_demande.createur_id;
end;
$$;

create or replace function refuser_verification(p_demande_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_demande record;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not exists (select 1 from users where id = auth.uid() and est_admin = true) then
    raise exception 'not authorized';
  end if;

  select * into v_demande from demandes_verification where id = p_demande_id for update;
  if v_demande is null then
    raise exception 'demande not found';
  end if;
  if v_demande.statut in ('approuve', 'refuse') then
    raise exception 'demande already processed';
  end if;

  update demandes_verification
    set statut = 'refuse', traite_par = auth.uid(), traite_at = now()
    where id = p_demande_id;
end;
$$;

revoke all on function approuver_verification(uuid) from public;
grant execute on function approuver_verification(uuid) to authenticated;
revoke all on function refuser_verification(uuid) from public;
grant execute on function refuser_verification(uuid) to authenticated;

-- Public badge -- trailing column only (CREATE OR REPLACE VIEW can add
-- new trailing columns but cannot reorder/insert among existing ones).
create or replace view public.profils_publics as
  select id, pays, devise, date_creation, pseudo, bio, photo_r2_key,
         lien_reseau_social, nom_affichage,
         lien_tiktok, lien_instagram, lien_youtube, lien_autre,
         createur_verifie
  from users;

create or replace view public.profils_explorables as
  select p.id, p.pays, p.devise, p.date_creation, p.pseudo, p.bio,
         p.photo_r2_key, p.lien_reseau_social, p.nom_affichage,
         p.createur_verifie
  from profils_publics p
  join users u on u.id = p.id
  where u.masque_exploration = false
    and exists (
      select 1 from offres o where o.createur_id = p.id and o.actif = true
    );
