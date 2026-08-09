-- Concours entre créateurs, Phase 1 (mode entre_createurs only). A
-- créateur invites other créateurs into a shared, time-limited contest;
-- each participant keeps their own pre-existing `campagne` offre and the
-- money still flows straight to them exactly as it already does for any
-- other campagne contribution -- the contest is purely a display/
-- aggregation layer on top, never a new money-movement mechanism. See
-- CLAUDE.md's "Fundraising campaigns" section for `montant_collecte`
-- being computed live, never stored -- this feature reuses that exact
-- computation via campagnes_montant_collecte rather than duplicating it.
--
-- `mode` exists on `concours` from day one (to avoid a painful later
-- migration) but this lot's own RPCs can only ever produce
-- `mode = 'entre_createurs'` -- there is no parameter anywhere in this
-- file that lets a caller request `'maitre_du_jeu'`. That second mode
-- (an external organizer skimming a configurable percentage via a
-- 3-way split transaction) is Phase 2 and is NOT built here -- see
-- CLAUDE.md.

create table concours (
  id uuid primary key default gen_random_uuid(),
  nom text not null check (char_length(nom) between 1 and 100),
  mode text not null default 'entre_createurs' check (mode in ('entre_createurs', 'maitre_du_jeu')),
  organisateur_id uuid not null references users(id),
  date_fin timestamptz not null,
  created_at timestamptz not null default now()
);

create table concours_participants (
  concours_id uuid not null references concours(id) on delete cascade,
  createur_id uuid not null references users(id),
  campagne_id uuid not null references offres(id),
  invite_statut text not null default 'invite' check (invite_statut in ('invite', 'accepte', 'refuse')),
  invite_at timestamptz not null default now(),
  primary key (concours_id, createur_id)
);

-- No INSERT/UPDATE/DELETE policy for authenticated on either table --
-- same "state machine only via a vetted RPC" shape as
-- transactions/publications/demandes_verification. Public reads go
-- through concours_publics below, never these raw tables (which would
-- otherwise leak invite_statut='invite'/'refuse' rows to anyone).
alter table concours enable row level security;
alter table concours_participants enable row level security;

-- ---------------------------------------------------------------------
-- creer_concours() -- the organizer's own first campagne is inserted as
-- an already-accepted participant in the same call, atomically: there's
-- no meaningful "organizer invites themselves and waits to accept" step.
-- ---------------------------------------------------------------------
create or replace function creer_concours(p_nom text, p_date_fin timestamptz, p_campagne_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_offre offres%rowtype;
  v_concours_id uuid;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select * into v_offre from offres where offres.id = p_campagne_id;

  if v_offre.id is null then
    raise exception 'campaign not found';
  end if;

  if v_offre.type != 'campagne' then
    raise exception 'not authorized: p_campagne_id must reference a campagne offre';
  end if;

  if v_offre.createur_id is distinct from v_user_id then
    raise exception 'not authorized: you can only use your own campaign';
  end if;

  insert into concours (nom, mode, organisateur_id, date_fin)
    values (p_nom, 'entre_createurs', v_user_id, p_date_fin)
    returning concours.id into v_concours_id;

  insert into concours_participants (concours_id, createur_id, campagne_id, invite_statut)
    values (v_concours_id, v_user_id, p_campagne_id, 'accepte');

  return v_concours_id;
end;
$$;

revoke all on function creer_concours(text, timestamptz, uuid) from public;
grant execute on function creer_concours(text, timestamptz, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- inviter_participant_concours() -- organizer-only. The ownership check
-- on p_campagne_id is what closes the real hole this brief calls out
-- explicitly: without it, the organizer could link ANY créateur's
-- campagne_id to an invitation for a DIFFERENT créateur, corrupting the
-- contest's own display data (someone else's collected total attributed
-- to the wrong participant). The check is against the INVITED créateur
-- (p_createur_id), not the caller.
-- ---------------------------------------------------------------------
create or replace function inviter_participant_concours(
  p_concours_id uuid,
  p_createur_id uuid,
  p_campagne_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_organisateur_id uuid;
  v_offre offres%rowtype;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select concours.organisateur_id into v_organisateur_id
    from concours where concours.id = p_concours_id;

  if v_organisateur_id is null then
    raise exception 'concours not found';
  end if;

  if v_organisateur_id is distinct from v_user_id then
    raise exception 'not authorized: only the concours organizer can invite participants';
  end if;

  select * into v_offre from offres where offres.id = p_campagne_id;

  if v_offre.id is null then
    raise exception 'campaign not found';
  end if;

  if v_offre.type != 'campagne' then
    raise exception 'not authorized: p_campagne_id must reference a campagne offre';
  end if;

  if v_offre.createur_id is distinct from p_createur_id then
    raise exception 'not authorized: this campaign does not belong to the invited créateur';
  end if;

  insert into concours_participants (concours_id, createur_id, campagne_id, invite_statut)
    values (p_concours_id, p_createur_id, p_campagne_id, 'invite');
end;
$$;

revoke all on function inviter_participant_concours(uuid, uuid, uuid) from public;
grant execute on function inviter_participant_concours(uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- accepter_invitation_concours() / refuser_invitation_concours() --
-- self-only, restricted to the invited créateur's own still-pending row.
-- Each distinguishes "no such invitation for you" from "already
-- resolved" rather than silently no-op'ing either way.
-- ---------------------------------------------------------------------
create or replace function accepter_invitation_concours(p_concours_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_statut text;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select concours_participants.invite_statut into v_statut
    from concours_participants
    where concours_participants.concours_id = p_concours_id
      and concours_participants.createur_id = v_user_id;

  if v_statut is null then
    raise exception 'invitation not found';
  end if;

  if v_statut != 'invite' then
    raise exception 'invitation already resolved';
  end if;

  update concours_participants set invite_statut = 'accepte'
    where concours_participants.concours_id = p_concours_id
      and concours_participants.createur_id = v_user_id;
end;
$$;

revoke all on function accepter_invitation_concours(uuid) from public;
grant execute on function accepter_invitation_concours(uuid) to authenticated;

create or replace function refuser_invitation_concours(p_concours_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_statut text;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select concours_participants.invite_statut into v_statut
    from concours_participants
    where concours_participants.concours_id = p_concours_id
      and concours_participants.createur_id = v_user_id;

  if v_statut is null then
    raise exception 'invitation not found';
  end if;

  if v_statut != 'invite' then
    raise exception 'invitation already resolved';
  end if;

  update concours_participants set invite_statut = 'refuse'
    where concours_participants.concours_id = p_concours_id
      and concours_participants.createur_id = v_user_id;
end;
$$;

revoke all on function refuser_invitation_concours(uuid) from public;
grant execute on function refuser_invitation_concours(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- concours_publics -- one row per ACCEPTED participant (the join
-- condition itself excludes 'invite'/'refuse' rows entirely, not just a
-- hidden column -- those statuses can never appear here regardless of
-- what a caller selects). montant_collecte is read from
-- campagnes_montant_collecte (migration 0017), never recomputed here --
-- same "aggregate only, never duplicate the calculation" discipline
-- already established for that view. LEFT JOIN + coalesce so a
-- brand-new campagne with zero contributions still reads 0 rather than
-- being silently dropped by an inner join.
--
-- Display columns (pseudo/nom_affichage/photo_r2_key) are joined
-- straight from `users` (view-owner bypassrls, same mechanism
-- classement_volume/profils_explorables/badges_fidelite_publics already
-- rely on), selecting only the same public-safe subset profils_publics
-- itself exposes -- never telephone or anything else sensitive.
-- Granted to anon: a shared concours link must work for a logged-out
-- visitor, same as every other public discovery view in this project.
-- ---------------------------------------------------------------------
create view public.concours_publics as
  select
    c.id as concours_id,
    c.nom,
    c.mode,
    c.organisateur_id,
    c.date_fin,
    c.created_at,
    cp.createur_id,
    cp.campagne_id,
    coalesce(cmc.montant_collecte, 0) as montant_collecte,
    u.pseudo,
    u.nom_affichage,
    u.photo_r2_key
  from concours c
  join concours_participants cp
    on cp.concours_id = c.id and cp.invite_statut = 'accepte'
  join users u on u.id = cp.createur_id
  left join campagnes_montant_collecte cmc on cmc.offre_id = cp.campagne_id;

grant select on public.concours_publics to authenticated, anon;

-- ---------------------------------------------------------------------
-- Reserved pseudo -- same two-places discipline as every previous route
-- addition (finance in 0027, offres in 0028, home in 0029, ...):
-- DB constraint here, PSEUDO_MOTS_RESERVES in src/lib/validation.ts.
-- ---------------------------------------------------------------------
alter table users drop constraint users_pseudo_not_reserved;
alter table users add constraint users_pseudo_not_reserved
  check (
    pseudo is null or lower(pseudo) not in (
      'dashboard', 'signup', 'login', 'api', 'auth',
      'createur', 'mes-transactions', 'paiement', 'parametres', 'explorer',
      'mot-de-passe-oublie', 'reinitialiser-mot-de-passe', 'admin', 'classement',
      'finance', 'offres', 'home', 'concours'
    )
  );
