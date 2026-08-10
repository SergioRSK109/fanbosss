-- Creator contests, Phase 2: mode 'maitre_du_jeu' (3-way payment split).
-- Follow-up to Phase 1/1-bis (migrations 0045/0046, mode entre_createurs
-- only). An external organizer ("Maître du jeu", not necessarily
-- themselves a créateur) puts up several créateurs against each other and
-- skims a configurable percentage off each contribution, planned once at
-- concours creation time.
--
-- Non-negotiable security principle, already settled in discussion, never
-- to be broken by this migration: a fan's money always goes straight to
-- the créateur they chose to support, in a SINGLE real CinetPay
-- transaction. The Maître du jeu's cut is NEVER a separate transfer after
-- the fact, and NEVER a wallet-to-wallet transfer between two accounts --
-- it's a third split line computed ATOMICALLY, at payment time, exactly
-- the way the platform's own commission already is. An internal
-- value-transfer between two accounts, outside the CinetPay circuit, was
-- explicitly ruled out elsewhere in this project (créateur-to-créateur
-- donations) precisely because it starts to look like e-money to the DRC
-- regulator (BCC). This migration doesn't reintroduce that pattern -- see
-- CLAUDE.md's "Atomic 3-way payment split" section for the full
-- reasoning, kept visible there for any future session that touches this
-- mechanism.
--
-- Second settled principle: the fan never sees the Maître du jeu's exact
-- percentage before paying -- only a context mention ("Fait partie du
-- tournoi [nom]"), never a financial disclosure. The fan always pays
-- exactly the créateur's displayed offer price; the split happens behind
-- the scenes, out of the créateur's revenue, never as a visible surcharge.

-- ---------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------
alter table concours add column pourcentage_maitre_jeu numeric check (pourcentage_maitre_jeu between 0 and 100);
alter table concours add column photo_trophee_r2_key text;
alter table concours_participants add column conditions_acceptees boolean not null default false;

alter table paiements add column montant_maitre_jeu_id uuid references users(id);
alter table paiements add column montant_maitre_jeu numeric;

-- ---------------------------------------------------------------------
-- 2. concours_publics -- restructured from INNER to LEFT JOIN, plus the
-- trophy photo as a trailing column (CREATE OR REPLACE VIEW can append
-- trailing columns but not reorder/insert among existing ones -- see
-- CLAUDE.md's publications_accueil/0037 note for this exact convention).
--
-- Why LEFT JOIN, a real behavioral change: unlike creer_concours()
-- (Phase 1), creer_concours_maitre_jeu() below does NOT auto-accept the
-- organizer as a participant -- a Maître du jeu isn't necessarily a
-- créateur with a campagne to link at all. Under the old INNER JOIN, a
-- freshly-created maitre_du_jeu concours with zero accepted participants
-- would have exactly ZERO rows in concours_publics, breaking three
-- things: the public page (404s on zero rows, so the organizer couldn't
-- even preview/share it or show off the trophy photo before anyone
-- joined), and getConcoursGereesEtInvitations()'s "mes concours" list
-- (which, before this migration, only ever discovered a concours through
-- the caller's OWN concours_participants row -- something the organizer
-- of a maitre_du_jeu concours never has). LEFT JOIN makes `concours`
-- itself the driving table: every concours now has at least one row here
-- (participant columns null when nobody has accepted yet), and this is
-- verified to NOT change any existing count-based assertion for
-- entre_createurs concours below, since a LEFT JOIN only ever adds an
-- extra row when there are literally zero matches for that concours --
-- every entre_createurs fixture already has >=1 accepted participant
-- (the organizer, auto-accepted by creer_concours() since Phase 1), so
-- existing counts are completely unaffected.
--
-- pourcentage_maitre_jeu is deliberately NOT exposed here, unlike the
-- trophy photo -- this view is granted to anon (a shared concours link
-- must work logged out), and the fan-never-sees-the-percentage principle
-- above would be defeated the instant a curious fan queried this public
-- view/REST endpoint directly. The percentage is readable only via the
-- concours_select_involved RLS policy below (organizer or invited/
-- accepted participant), read directly off the raw `concours` table by
-- application code that already knows it's talking to an involved party.
-- ---------------------------------------------------------------------
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
    c.photo_trophee_r2_key
  from concours c
  left join concours_participants cp
    on cp.concours_id = c.id and cp.invite_statut = 'accepte'
  left join users u on u.id = cp.createur_id
  left join campagnes_montant_collecte cmc on cmc.offre_id = cp.campagne_id;

-- No grant restatement -- concours_publics has been granted to
-- authenticated+anon since its own creation in migration 0045 and has
-- never had that narrowed, so CREATE OR REPLACE VIEW's own
-- grant-preserving behavior is sufficient (see CLAUDE.md's migration
-- 0037 note on why a grant should only ever be restated when there's a
-- narrowing to actually preserve, never gratuitously copied forward).
-- Re-verified directly in checklist_2_3.sql regardless, same discipline
-- as every other view change in this project.

-- ---------------------------------------------------------------------
-- 3. concours_select_involved -- the raw `concours` table has had zero
-- SELECT policies since its own creation (migration 0045: "public reads
-- go through concours_publics, never these raw tables"). That's still
-- true for an uninvolved caller, but this lot needs two legitimate,
-- self-scoped reads of the raw table that concours_publics can't safely
-- serve (it deliberately never exposes pourcentage_maitre_jeu, see
-- above): the organizer previewing/managing their own concours, and an
-- invited-or-accepted créateur reading the exact split they're being
-- asked to agree to (the consent screen, brief point 7). Same
-- "self-only SELECT on an otherwise RPC-only table" precedent already
-- established twice for this exact feature (concours_participants_select_own,
-- migration 0046) and elsewhere (reservations_stock_select_own, migration
-- 0039) -- this doesn't open concours up to arbitrary reads, only to the
-- two parties who already have a legitimate reason to see the split.
-- ---------------------------------------------------------------------
create policy concours_select_involved on concours
  for select using (
    organisateur_id = auth.uid()
    or exists (
      select 1 from concours_participants
      where concours_participants.concours_id = concours.id
        and concours_participants.createur_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------
-- 4. create_paiement_on_validation() -- the actual technical core of
-- this lot. Extends the existing 15% HT + TVA (16%) formula (migration
-- 0024, untouched) with a third, optional split: when the offre being
-- paid is linked, via an ACCEPTED concours_participants row with
-- conditions_acceptees = true, to a concours in mode = 'maitre_du_jeu',
-- the Maître du jeu's cut is computed off the créateur's net-of-commission
-- total and subtracted from what the créateur actually receives --
-- exactly like the platform commission itself is computed and deducted,
-- never a second, separate movement of money.
--
-- conditions_acceptees = true is the ONLY trigger for the 3-way split --
-- never an implicit state inferred from anything else (e.g. merely being
-- linked to a maitre_du_jeu concours, or invite_statut = 'accepte' alone
-- without the consent flag). See accepter_invitation_concours() below for
-- where that flag is actually set, and CLAUDE.md for why a créateur must
-- explicitly consent before their revenue is ever split three ways.
--
-- In every other case -- no concours link at all, a concours link in
-- entre_createurs mode, or a maitre_du_jeu link whose consent flag isn't
-- true yet -- montant_net_createur/montant_maitre_jeu/montant_maitre_jeu_id
-- are exactly what they were before this migration (the join simply
-- matches nothing, v_maitre_jeu's fields all read NULL, and the ELSE
-- branch below reproduces migration 0024's formula byte-for-byte). This
-- is the single most important regression guarantee in this lot --
-- verified empirically against a throwaway database before being
-- trusted, then locked into checklist_2_3.sql, not just asserted here in
-- a comment.
--
-- A campagne could in principle be linked (accepted, consented) to more
-- than one maitre_du_jeu concours at once -- concours_participants has no
-- uniqueness constraint on campagne_id alone (see CLAUDE.md's "Creator
-- contests" section). This wasn't addressed by the brief; the tie-break
-- chosen here (most recently created concours wins) is a deliberate,
-- documented product judgment call, not an oversight -- flagged as such
-- since a future session might reasonably want a different rule (e.g.
-- reject a second maitre_du_jeu link outright at accept time) once this
-- edge case actually matters in practice.
-- ---------------------------------------------------------------------
create or replace function create_paiement_on_validation()
returns trigger
language plpgsql
as $$
declare
  v_commission numeric;
  v_frais numeric;
  v_tva numeric;
  v_net_total numeric;
  v_maitre_jeu record;
  v_montant_maitre_jeu numeric;
  v_montant_net_createur numeric;
  v_montant_maitre_jeu_id uuid;
begin
  if new.statut = 'validee' and old.statut is distinct from 'validee' then
    v_commission := round(new.montant * 0.15, 2);
    v_frais := round(new.montant * 0.03, 2);
    v_tva := round(v_commission * 0.16, 2);
    v_net_total := new.montant - v_commission - v_tva;

    select c.pourcentage_maitre_jeu as pourcentage, c.organisateur_id as organisateur
      into v_maitre_jeu
      from concours_participants cp
      join concours c on c.id = cp.concours_id
      where cp.campagne_id = new.offre_id
        and cp.invite_statut = 'accepte'
        and cp.conditions_acceptees = true
        and c.mode = 'maitre_du_jeu'
      order by c.created_at desc
      limit 1;

    if v_maitre_jeu.pourcentage is not null then
      v_montant_maitre_jeu := round(v_net_total * (v_maitre_jeu.pourcentage / 100), 2);
      v_montant_net_createur := v_net_total - v_montant_maitre_jeu;
      v_montant_maitre_jeu_id := v_maitre_jeu.organisateur;
    else
      v_montant_maitre_jeu := null;
      v_montant_net_createur := v_net_total;
      v_montant_maitre_jeu_id := null;
    end if;

    insert into paiements (
      transaction_id, montant_brut, commission_plateforme,
      frais_agregateur, tva, montant_net_createur,
      statut_paiement, reference_cinetpay,
      montant_maitre_jeu, montant_maitre_jeu_id
    )
    values (
      new.id, new.montant, v_commission,
      v_frais, v_tva, v_montant_net_createur,
      'initie', new.reference_cinetpay,
      v_montant_maitre_jeu, v_montant_maitre_jeu_id
    )
    on conflict (transaction_id) do nothing;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. solde_wallet_createur() -- extended, per instruction, to also sum
-- whatever the caller has earned as a Maître du jeu organizer
-- (paiements.montant_maitre_jeu_id = auth.uid()) into each of the three
-- existing buckets, added alongside their own créateur earnings (never
-- replacing them -- the same person can hold both roles at once, exactly
-- as this app already has no fan/créateur role split). Same
-- statut_paiement/confirmation_fan/litige conditions as the créateur
-- side, just keyed on montant_maitre_jeu_id instead of t.createur_id and
-- summing montant_maitre_jeu instead of montant_net_createur -- a
-- Maître du jeu's cut is frozen/unfrozen by the exact same underlying
-- transaction's state as the créateur's own share, since both come from
-- the same paiements row.
--
-- Same signature as before (create or replace, no drop needed) -- the
-- existing `authenticated`-only EXECUTE grant (migration 0027) is left
-- untouched.
-- ---------------------------------------------------------------------
create or replace function solde_wallet_createur(p_createur_id uuid)
returns table (
  en_attente_livraison numeric,
  en_litige numeric,
  net_a_retirer numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if p_createur_id is distinct from auth.uid() then
    raise exception 'not authorized';
  end if;

  return query
    select
      coalesce((
        select sum(p.montant_net_createur)
        from paiements p
        join transactions t on t.id = p.transaction_id
        where t.createur_id = p_createur_id
          and p.statut_paiement = 'initie'
      ), 0)
      + coalesce((
        select sum(p.montant_maitre_jeu)
        from paiements p
        where p.montant_maitre_jeu_id = p_createur_id
          and p.statut_paiement = 'initie'
      ), 0) as en_attente_livraison,
      coalesce((
        select sum(p.montant_net_createur)
        from paiements p
        join transactions t on t.id = p.transaction_id
        where t.createur_id = p_createur_id
          and p.statut_paiement = 'reussi'
          and t.confirmation_fan = 'conteste'
          and t.litige_resolu_at is null
      ), 0)
      + coalesce((
        select sum(p.montant_maitre_jeu)
        from paiements p
        join transactions t on t.id = p.transaction_id
        where p.montant_maitre_jeu_id = p_createur_id
          and p.statut_paiement = 'reussi'
          and t.confirmation_fan = 'conteste'
          and t.litige_resolu_at is null
      ), 0) as en_litige,
      (
        coalesce((
          select sum(p.montant_net_createur)
          from paiements p
          join transactions t on t.id = p.transaction_id
          where t.createur_id = p_createur_id
            and p.statut_paiement = 'reussi'
            and t.confirmation_fan in ('confirme', 'non_applicable')
        ), 0)
        + coalesce((
          select sum(p.montant_maitre_jeu)
          from paiements p
          join transactions t on t.id = p.transaction_id
          where p.montant_maitre_jeu_id = p_createur_id
            and p.statut_paiement = 'reussi'
            and t.confirmation_fan in ('confirme', 'non_applicable')
        ), 0)
        - coalesce((
          select sum(d.montant)
          from demandes_retrait d
          where d.createur_id = p_createur_id
            and d.statut != 'refuse'
        ), 0)
      ) as net_a_retirer;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. creer_concours_maitre_jeu() -- distinct from creer_concours()
-- (Phase 1): the organizer isn't necessarily a créateur with a campagne
-- to link, so there's no p_campagne_id and no auto-accepted participant
-- row inserted. Same SECURITY DEFINER + auth.uid()-required +
-- revoke/grant discipline as every write RPC since migration 0020.
-- ---------------------------------------------------------------------
create or replace function creer_concours_maitre_jeu(
  p_nom text,
  p_date_fin timestamptz,
  p_pourcentage_maitre_jeu numeric
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

  insert into concours (nom, mode, organisateur_id, date_fin, pourcentage_maitre_jeu)
    values (p_nom, 'maitre_du_jeu', v_user_id, p_date_fin, p_pourcentage_maitre_jeu)
    returning concours.id into v_concours_id;

  return v_concours_id;
end;
$$;

revoke all on function creer_concours_maitre_jeu(text, timestamptz, numeric) from public;
grant execute on function creer_concours_maitre_jeu(text, timestamptz, numeric) to authenticated;

-- ---------------------------------------------------------------------
-- 7. definir_photo_trophee_concours() -- organizer-only. concours has no
-- UPDATE policy for authenticated at all (same "state machine only via a
-- vetted RPC" shape as every write path on this table since migration
-- 0045), so this is the only way to set photo_trophee_r2_key. The R2
-- upload route (below) already re-verifies ownership before minting a
-- presigned URL; this RPC re-verifies it again independently rather than
-- trusting that prior check -- same defense-in-depth discipline as every
-- other ownership-gated RPC in this project.
-- ---------------------------------------------------------------------
create or replace function definir_photo_trophee_concours(p_concours_id uuid, p_r2_key text)
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
    raise exception 'not authorized: only the concours organizer can set the trophy photo';
  end if;

  update concours set photo_trophee_r2_key = p_r2_key where concours.id = p_concours_id;
end;
$$;

revoke all on function definir_photo_trophee_concours(uuid, text) from public;
grant execute on function definir_photo_trophee_concours(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 8. accepter_invitation_concours() -- signature extended with a 3rd
-- parameter, p_conditions_acceptees boolean default false. Dropped and
-- recreated outright (not a second overload) -- same no-backwards-
-- compatibility-shim discipline as every earlier signature change in
-- this codebase (publier_message across migrations 0029/0031/0037,
-- toggler_repost_publication in 0032). Every existing 2-arg call site in
-- this project (the app's own /api/concours/[id]/accepter route, and
-- every pre-existing entre_createurs test in checklist_2_3.sql) keeps
-- working unchanged -- Postgres resolves a call with fewer arguments than
-- declared against a defaulted trailing parameter, so those callers
-- transparently get p_conditions_acceptees = false, exactly the
-- "simply ignored, never required" behavior the brief specifies for
-- entre_createurs.
--
-- For a concours in mode = 'maitre_du_jeu': p_conditions_acceptees must
-- be explicitly true, or the call is rejected outright -- not silently
-- treated as a no-op accept. This is the ONLY place conditions_acceptees
-- is ever set to true; create_paiement_on_validation() above trusts this
-- flag completely rather than re-deriving consent from anything else.
-- Eligibility (own row, still 'invite') is still checked first, exactly
-- as migration 0046 established -- a caller with no invitation at all
-- gets 'invitation not found' regardless of mode or consent value.
-- ---------------------------------------------------------------------
drop function if exists accepter_invitation_concours(uuid, uuid);

create or replace function accepter_invitation_concours(
  p_concours_id uuid,
  p_campagne_id uuid,
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
  v_mode text;
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

  select concours.mode into v_mode from concours where concours.id = p_concours_id;

  if v_mode = 'maitre_du_jeu' and p_conditions_acceptees is not true then
    raise exception 'you must accept the revenue-share terms to join a maître du jeu concours';
  end if;

  perform verifier_campagne_du_createur(p_campagne_id, v_user_id);

  update concours_participants
    set invite_statut = 'accepte', campagne_id = p_campagne_id, conditions_acceptees = p_conditions_acceptees
    where concours_participants.concours_id = p_concours_id
      and concours_participants.createur_id = v_user_id;
end;
$$;

revoke all on function accepter_invitation_concours(uuid, uuid, boolean) from public;
grant execute on function accepter_invitation_concours(uuid, uuid, boolean) to authenticated;
