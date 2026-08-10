-- Phase 1-bis, correcting a real design flaw in Phase 1 (migration 0045):
-- inviter_participant_concours() originally required the ORGANIZER to
-- supply the invited créateur's campagne_id up front. That's not
-- something an organizer can ever actually know -- nobody knows someone
-- else's internal offre id, and even resolving "their campagne" by
-- pseudo would still be guessing at which of the invitee's several
-- campagnes (if any) they'd want linked. The invited créateur is the
-- only one who can correctly supply their own campagne_id, and only once
-- they've actually decided to accept.
--
-- Fixed by splitting invitation into two genuinely separate steps: the
-- organizer invites by IDENTITY only (no campagne involved at all), and
-- the invited créateur supplies their own campagne_id atomically at the
-- moment they accept. concours_participants.campagne_id must therefore
-- be nullable between those two steps -- null while `invite_statut =
-- 'invite'`, always set the instant it becomes `'accepte'`.

alter table concours_participants alter column campagne_id drop not null;

-- A créateur needs to be able to read their OWN participation rows
-- directly (to show "Invitations en attente" on /offres) -- but
-- concours_participants still has zero INSERT/UPDATE/DELETE policies for
-- authenticated (every write still goes through a vetted RPC) and, until
-- now, no SELECT policy either (public reads went through
-- concours_publics, which deliberately never exposes a pending/refused
-- row to anyone). Without this, a créateur's own pending invitation
-- would be invisible even to themselves. Same exact precedent already
-- established for reservations_stock_select_own (migration 0039,
-- physical products) -- a self-only SELECT policy on an otherwise
-- RPC-only table, needed specifically so the legitimate owner can read
-- back their own row through the normal authenticated client.
create policy concours_participants_select_own on concours_participants
  for select using (createur_id = auth.uid());

-- ---------------------------------------------------------------------
-- verifier_campagne_du_createur() -- the ownership+type check
-- creer_concours() already had inline, now shared (not duplicated) with
-- accepter_invitation_concours() below, which needs the exact same
-- check: "does p_campagne_id exist, is it really a campagne offre, and
-- does it belong to p_createur_id". Deliberately NOT security definer --
-- called only from within another security definer function's body, it
-- inherits that function's already-elevated execution context the same
-- way soutient_createur() (a plain function) does when called from
-- inside peut_voir_publication_complete() (migration 0029) -- no
-- separate grant needed for this to work, and none is given: revoked
-- from public, granted to nobody. This is a purely internal helper, never
-- meant to be called directly by any role.
-- ---------------------------------------------------------------------
create or replace function verifier_campagne_du_createur(p_campagne_id uuid, p_createur_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_offre offres%rowtype;
begin
  select * into v_offre from offres where offres.id = p_campagne_id;

  if v_offre.id is null then
    raise exception 'campaign not found';
  end if;

  if v_offre.type != 'campagne' then
    raise exception 'not authorized: p_campagne_id must reference a campagne offre';
  end if;

  if v_offre.createur_id is distinct from p_createur_id then
    raise exception 'not authorized: you can only use your own campaign';
  end if;
end;
$$;

revoke all on function verifier_campagne_du_createur(uuid, uuid) from public;

-- creer_concours() itself is unchanged in behavior and signature --
-- `create or replace` here only swaps its inline ownership+type check
-- for a call to the shared helper above, so the two can never drift
-- apart. Error wording is identical to before (the helper produces the
-- exact same messages creer_concours() already raised directly).
create or replace function creer_concours(p_nom text, p_date_fin timestamptz, p_campagne_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_concours_id uuid;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  perform verifier_campagne_du_createur(p_campagne_id, v_user_id);

  insert into concours (nom, mode, organisateur_id, date_fin)
    values (p_nom, 'entre_createurs', v_user_id, p_date_fin)
    returning concours.id into v_concours_id;

  insert into concours_participants (concours_id, createur_id, campagne_id, invite_statut)
    values (v_concours_id, v_user_id, p_campagne_id, 'accepte');

  return v_concours_id;
end;
$$;

-- ---------------------------------------------------------------------
-- inviter_participant_concours() -- signature simplified to identity
-- only (p_concours_id, p_createur_id). The old 3-arg signature is
-- dropped outright, not kept as a second overload -- this project
-- doesn't carry backwards-compatibility shims (see AGENTS.md), and the
-- one caller (POST /api/concours/[id]/inviter) is updated in the same
-- change. Inserts at campagne_id = null, invite_statut = 'invite' --
-- the campagne is supplied later, by the invitee themselves, at accept
-- time.
-- ---------------------------------------------------------------------
drop function if exists inviter_participant_concours(uuid, uuid, uuid);

create or replace function inviter_participant_concours(p_concours_id uuid, p_createur_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_organisateur_id uuid;
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

  insert into concours_participants (concours_id, createur_id, campagne_id, invite_statut)
    values (p_concours_id, p_createur_id, null, 'invite');
end;
$$;

revoke all on function inviter_participant_concours(uuid, uuid) from public;
grant execute on function inviter_participant_concours(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- accepter_invitation_concours() -- signature extended to
-- (p_concours_id, p_campagne_id). The old 1-arg signature is dropped
-- outright (same no-shim discipline). Eligibility (own row, still
-- 'invite') is checked first, exactly as before -- a caller with no
-- invitation at all still gets 'invitation not found' regardless of
-- what p_campagne_id they supplied, and a second accept attempt still
-- gets 'invitation already resolved'. Only once eligibility is confirmed
-- does it verify p_campagne_id via the shared helper (own campagne,
-- real type) -- reused, not duplicated, from creer_concours(). Setting
-- campagne_id and flipping invite_statut happen in the same UPDATE, so
-- concours_publics (which filters on invite_statut = 'accepte') can
-- never observe an accepted row with a still-null campagne_id.
-- ---------------------------------------------------------------------
drop function if exists accepter_invitation_concours(uuid);

create or replace function accepter_invitation_concours(p_concours_id uuid, p_campagne_id uuid)
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

  perform verifier_campagne_du_createur(p_campagne_id, v_user_id);

  update concours_participants
    set invite_statut = 'accepte', campagne_id = p_campagne_id
    where concours_participants.concours_id = p_concours_id
      and concours_participants.createur_id = v_user_id;
end;
$$;

revoke all on function accepter_invitation_concours(uuid, uuid) from public;
grant execute on function accepter_invitation_concours(uuid, uuid) to authenticated;

-- refuser_invitation_concours() is untouched -- same signature, same
-- behavior, never involved a campagne_id at all.
