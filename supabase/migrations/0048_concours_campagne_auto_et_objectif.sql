-- Creator contests: auto-generated campagne + points objective / record
-- time. Two distinct but jointly-designed changes, shipped in the same
-- migration because they touch the exact same two RPCs
-- (creer_concours(), accepter_invitation_concours()) -- see CLAUDE.md's
-- "Creator contests -- campagne auto-générée + objectif/temps record"
-- section for the full reasoning.
--
-- PART A -- the campagne a concours needs (to actually take payments,
-- via the existing don-style free-amount checkout) becomes an internal
-- implementation detail, never chosen or seen by the créateur. Until
-- now, creer_concours()/accepter_invitation_concours() both required the
-- caller to supply an EXISTING campagne offre id -- which broke outright
-- for a créateur who'd never created one, and exposed a detail
-- ("campagne") the user never asked about. Both RPCs now create and own
-- a synthetic campagne offre automatically, in the same transaction,
-- tagged with a new offres.genere_pour_concours_id column so every
-- display surface that lists a créateur's own campagnes (OffresManager,
-- the public profile) can filter it straight back out.
--
-- PART B -- a concours can optionally define a points objective
-- (objectif_points) and, only alongside one, an intermediate "record
-- time" deadline (temps_record) to reach it first. See
-- concours_vainqueur_objectif below for the winner-determination
-- mechanism this needs -- the delicate part of this migration, per the
-- brief's own explicit flag.

-- =========================================================================
-- PART A.1 -- offres.genere_pour_concours_id
-- =========================================================================

alter table offres add column genere_pour_concours_id uuid references concours(id);

-- campagnes_publiques (migration 0017) gains genere_pour_concours_id as a
-- trailing column (CREATE OR REPLACE VIEW can append, never reorder --
-- see the concours_publics note further below for this same convention)
-- so getCreateurProfileData() (src/lib/profil.ts, the public profile's
-- own campagnes query) can filter a synthetic campagne back out with
-- `.is("genere_pour_concours_id", null)`, the same way OffresManager's
-- own query filters the raw `offres` table directly. This is what makes
-- Part A's "never chosen or seen by the créateur" guarantee actually
-- hold on the ONE surface that reads campagnes through this view rather
-- than the raw table.
create or replace view public.campagnes_publiques as
  select id, createur_id, libelle, actif, config, created_at, genere_pour_concours_id
  from offres
  where type = 'campagne';

-- No grant restatement -- campagnes_publiques has been granted to
-- authenticated+anon since migration 0017 and has never had that
-- narrowed.

-- =========================================================================
-- PART B.1 -- concours.date_debut / objectif_points / temps_record
--
-- date_debut is purely informative for display ("le concours ouvre le
-- ..."), never a technical gate -- a fan can pay before/during/after it
-- with no code path checking it at all (confirmed by grep: nothing in
-- this migration or the checkout flow ever reads date_debut for an
-- authorization decision).
--
-- temps_record requires objectif_points (a record time with nothing to
-- race toward makes no sense) -- enforced at the DB level, the real
-- guarantee, mirrored by client-side progressive disclosure in the
-- creation forms (see ConcoursManager.tsx) so the question never even
-- appears unless an objective was already set.
-- =========================================================================

alter table concours add column date_debut timestamptz;
alter table concours add column objectif_points numeric check (objectif_points > 0);
alter table concours add column temps_record timestamptz;

alter table concours add constraint concours_temps_record_requiert_objectif
  check (temps_record is null or objectif_points is not null);

alter table concours add constraint concours_dates_coherentes
  check (
    (date_debut is null or date_debut < date_fin)
    and (temps_record is null or temps_record < date_fin)
  );

-- =========================================================================
-- PART A.2 -- creer_concours(), signature simplified: p_campagne_id is
-- gone, replaced by the three new optional Part B parameters. The
-- organizer's own synthetic campagne is created and linked atomically,
-- in the same transaction as the concours + the auto-accepted
-- participant row -- there's still no meaningful "organizer invites
-- themselves and waits" step, exactly as before this migration.
--
-- The synthetic campagne's config carries only date_fin (formatted
-- 'YYYY-MM-DD', matching the concours' own date_fin) -- deliberately no
-- objectif/description keys. This is not an oversight: close_campagne_if_goal_reached()
-- (migration 0017) already treats a missing/malformed config->>'objectif'
-- as "no goal, never auto-close on amount", and offres_prix_required_unless_don
-- already exempts campagne from needing a fixed prix -- a campagne
-- offre with no objectif is already a fully-supported state in the
-- existing schema, confirmed by reading that trigger before relying on
-- it rather than assumed. Giving it a real date_fin is what lets the
-- EXISTING close_expired_campagnes() cron (already running hourly, see
-- CLAUDE.md's "Transaction lifecycle") auto-close this campagne the
-- moment the concours' own end date passes too, with zero new code.
--
-- The libelle is derived from the concours' own name plus its id, per
-- the brief -- the id suffix is what guarantees uniqueness against
-- unique_offre_type_par_createur (NULLS NOT DISTINCT (createur_id, type,
-- libelle), migration 0007): a créateur could otherwise organize two
-- concours with the identical nom, and a plain "nom-derived" libelle
-- would collide on the second INSERT. This text is never rendered
-- anywhere -- the whole point of Part A is that this offre stays
-- invisible -- so the exact wording doesn't matter, only its uniqueness
-- does.
-- =========================================================================
drop function if exists creer_concours(text, timestamptz, uuid);

create or replace function creer_concours(
  p_nom text,
  p_date_fin timestamptz,
  p_date_debut timestamptz default null,
  p_objectif_points numeric default null,
  p_temps_record timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_concours_id uuid;
  v_campagne_id uuid;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  insert into concours (nom, mode, organisateur_id, date_fin, date_debut, objectif_points, temps_record)
    values (p_nom, 'entre_createurs', v_user_id, p_date_fin, p_date_debut, p_objectif_points, p_temps_record)
    returning concours.id into v_concours_id;

  insert into offres (createur_id, type, prix, libelle, config, actif, genere_pour_concours_id)
    values (
      v_user_id,
      'campagne',
      null,
      p_nom || ' (concours ' || v_concours_id::text || ')',
      jsonb_build_object('date_fin', to_char(p_date_fin, 'YYYY-MM-DD')),
      true,
      v_concours_id
    )
    returning offres.id into v_campagne_id;

  insert into concours_participants (concours_id, createur_id, campagne_id, invite_statut)
    values (v_concours_id, v_user_id, v_campagne_id, 'accepte');

  return v_concours_id;
end;
$$;

revoke all on function creer_concours(text, timestamptz, timestamptz, numeric, timestamptz) from public;
grant execute on function creer_concours(text, timestamptz, timestamptz, numeric, timestamptz) to authenticated;

-- =========================================================================
-- PART A.2 (Maître du jeu side) -- creer_concours_maitre_jeu() gains the
-- same three Part B parameters. No campagne-creation change here: this
-- function has never auto-accepted the organizer as a participant (a
-- Maître du jeu isn't necessarily a créateur with anything to link), so
-- there was never a campagne to create in this path and still isn't.
-- =========================================================================
drop function if exists creer_concours_maitre_jeu(text, timestamptz, numeric);

create or replace function creer_concours_maitre_jeu(
  p_nom text,
  p_date_fin timestamptz,
  p_pourcentage_maitre_jeu numeric,
  p_date_debut timestamptz default null,
  p_objectif_points numeric default null,
  p_temps_record timestamptz default null
)
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

  if p_pourcentage_maitre_jeu is null
    or p_pourcentage_maitre_jeu < 0
    or p_pourcentage_maitre_jeu > 100
  then
    raise exception 'p_pourcentage_maitre_jeu must be between 0 and 100';
  end if;

  insert into concours (
    nom, mode, organisateur_id, date_fin, pourcentage_maitre_jeu,
    date_debut, objectif_points, temps_record
  )
    values (
      p_nom, 'maitre_du_jeu', v_user_id, p_date_fin, p_pourcentage_maitre_jeu,
      p_date_debut, p_objectif_points, p_temps_record
    )
    returning concours.id into v_concours_id;

  return v_concours_id;
end;
$$;

revoke all on function creer_concours_maitre_jeu(text, timestamptz, numeric, timestamptz, numeric, timestamptz) from public;
grant execute on function creer_concours_maitre_jeu(text, timestamptz, numeric, timestamptz, numeric, timestamptz) to authenticated;

-- =========================================================================
-- PART A.3 -- accepter_invitation_concours(), signature simplified:
-- p_campagne_id is gone. Eligibility (own row, still 'invite') is still
-- checked first, exactly as migrations 0046/0047 established -- a caller
-- with no invitation at all still gets 'invitation not found' regardless
-- of mode/consent. Only once eligibility (and, for maitre_du_jeu,
-- consent) is confirmed does this create the accepting créateur's own
-- synthetic campagne and link it, atomically, in the same UPDATE that
-- flips invite_statut -- concours_publics (filtered to invite_statut =
-- 'accepte') can still never observe an accepted row with a null
-- campagne_id, the exact guarantee migration 0046 already established,
-- now trivially true since nothing external is ever supplied to fail.
-- =========================================================================
drop function if exists accepter_invitation_concours(uuid, uuid, boolean);

create or replace function accepter_invitation_concours(
  p_concours_id uuid,
  p_conditions_acceptees boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_statut text;
  v_concours concours%rowtype;
  v_campagne_id uuid;
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

  select * into v_concours from concours where concours.id = p_concours_id;

  if v_concours.mode = 'maitre_du_jeu' and p_conditions_acceptees is not true then
    raise exception 'you must accept the revenue-share terms to join a maître du jeu concours';
  end if;

  insert into offres (createur_id, type, prix, libelle, config, actif, genere_pour_concours_id)
    values (
      v_user_id,
      'campagne',
      null,
      v_concours.nom || ' (concours ' || p_concours_id::text || ')',
      jsonb_build_object('date_fin', to_char(v_concours.date_fin, 'YYYY-MM-DD')),
      true,
      p_concours_id
    )
    returning offres.id into v_campagne_id;

  update concours_participants
    set invite_statut = 'accepte', campagne_id = v_campagne_id, conditions_acceptees = p_conditions_acceptees
    where concours_participants.concours_id = p_concours_id
      and concours_participants.createur_id = v_user_id;
end;
$$;

revoke all on function accepter_invitation_concours(uuid, boolean) from public;
grant execute on function accepter_invitation_concours(uuid, boolean) to authenticated;

-- =========================================================================
-- PART A.6 -- verifier_campagne_du_createur() (migration 0046) had
-- exactly two callers, both above -- creer_concours() and
-- accepter_invitation_concours() -- and neither needs it anymore now
-- that a p_campagne_id is never supplied by a client at all. Confirmed
-- via grep (no other caller anywhere in supabase/migrations or src/)
-- before removing it outright, per this project's own "don't leave dead
-- code behind" discipline -- there is no plausible future caller either,
-- since the whole point of Part A is that a client never supplies a
-- campagne id to validate in the first place.
-- =========================================================================
drop function if exists verifier_campagne_du_createur(uuid, uuid);

-- =========================================================================
-- concours_publics -- date_debut/objectif_points/temps_record appended
-- as trailing columns (CREATE OR REPLACE VIEW can append, never
-- reorder/insert among existing columns -- see CLAUDE.md's
-- publications_accueil/0037 note for this exact convention). Unlike
-- pourcentage_maitre_jeu, these three are meant to be fully public --
-- brief point B.5 renders a progress bar/countdown from them directly on
-- this page for every visitor, logged in or not.
-- =========================================================================
create or replace view public.concours_publics as
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
    u.photo_r2_key,
    c.photo_trophee_r2_key,
    c.date_debut,
    c.objectif_points,
    c.temps_record
  from concours c
  left join concours_participants cp
    on cp.concours_id = c.id and cp.invite_statut = 'accepte'
  left join users u on u.id = cp.createur_id
  left join campagnes_montant_collecte cmc on cmc.offre_id = cp.campagne_id;

-- No grant restatement -- concours_publics has been granted to
-- authenticated+anon since migration 0045 and has never had that
-- narrowed (see migration 0047's own identical note). Re-verified
-- directly in checklist_2_3.sql regardless.

-- =========================================================================
-- PART B.3 -- concours_vainqueur_objectif: the winner-determination
-- mechanism for rules 1 & 2 (an objective, reached before its effective
-- deadline). This is deliberately a VIEW, not a SECURITY DEFINER
-- function -- the brief itself allows either ("fonction/vue"), and a
-- view is the better fit here: it reuses the exact same "owned by the
-- migration role, bypasses RLS on transactions, exposes only a public-safe
-- aggregate" mechanism campagnes_montant_collecte/classement_volume/
-- concours_publics already rely on, rather than adding a fourth
-- deliberate exception to "never grant SECURITY DEFINER to anon"
-- (peut_voir_publication_complete and incrementer_vue_publication are
-- the only two so far, each individually justified -- see CLAUDE.md).
-- A plain view needs no such exception at all: it's granted to anon the
-- same unremarkable way every other public aggregate view already is.
--
-- The delicate part, per the brief's own explicit flag: "who reached the
-- objective first" is NOT "who has the highest montant_collecte right
-- now" -- it's "at what precise instant did each participant's own
-- chronologically-sorted cumulative total first cross objectif_points,
-- and which of those instants (if any) is both the earliest AND strictly
-- before the effective deadline (temps_record if set, else date_fin)".
--
-- One CTE builds each participant's running cumulative total via a
-- window function ordered by (created_at, id) -- id as a tiebreaker for
-- the vanishingly unlikely case of two transactions sharing a timestamp,
-- for determinism, not because it matters in practice. The deadline
-- filter (t.created_at < deadline) is applied INSIDE this CTE, before
-- the cumulative sum is computed for the "did they cross it in time"
-- check -- this is what correctly implements "le temps record raté ne
-- ressuscite pas l'objectif plus tard": a participant whose total only
-- crosses objectif_points via a payment that lands AFTER the deadline
-- never shows a crossing in this view at all, for that concours, full
-- stop (their post-deadline payments are excluded from the cumulative
-- sum, not just from the crossing check).
--
-- The `t.created_at < deadline` filter also needs no separate "has the
-- deadline actually passed yet" check to correctly implement "vainqueur
-- déclaré dès cet instant" (not "only once the deadline is fully
-- elapsed") -- every real transaction's created_at is <= now() by
-- definition, so if the deadline is still in the future, the comparison
-- is automatically satisfied for every transaction that has actually
-- happened, and a mid-contest read already reflects "crossed with time
-- to spare" the instant it's true.
--
-- Zero rows for a concours means "no objectif_points at all" OR
-- "objectif_points defined but nobody reached it before the deadline" --
-- both cases fall through to the existing, UNCHANGED rule-3 fallback
-- already implemented in application code (computeLeaderIds +
-- isConcoursEnded, src/lib/concours.ts) -- this view deliberately does
-- NOT reimplement "highest total wins" itself, since that logic already
-- exists, is already tested, and reads its numbers straight from
-- concours_publics's own montant_collecte -- duplicating it here would
-- risk the two silently disagreeing.
-- =========================================================================
create view public.concours_vainqueur_objectif as
with deadlines as (
  select
    concours.id as concours_id,
    coalesce(concours.temps_record, concours.date_fin) as deadline,
    concours.objectif_points
  from concours
  where concours.objectif_points is not null
),
cumulatifs as (
  select
    d.concours_id,
    cp.createur_id,
    t.created_at,
    d.objectif_points,
    sum(t.montant) over (
      partition by d.concours_id, cp.createur_id
      order by t.created_at, t.id
    ) as cumul
  from deadlines d
  join concours_participants cp
    on cp.concours_id = d.concours_id and cp.invite_statut = 'accepte'
  join transactions t
    on t.offre_id = cp.campagne_id and t.statut = 'livree'
  where t.created_at < d.deadline
),
premiers_par_participant as (
  select concours_id, createur_id, min(created_at) as atteint_a
  from cumulatifs
  where cumul >= objectif_points
  group by concours_id, createur_id
)
select distinct on (concours_id)
  concours_id,
  createur_id,
  atteint_a
from premiers_par_participant
order by concours_id, atteint_a asc, createur_id asc;

grant select on public.concours_vainqueur_objectif to authenticated, anon;
