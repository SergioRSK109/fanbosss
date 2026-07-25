-- Proves brief checklist items 2 and 3 against a real Postgres instance
-- running the actual migrations (not a description of intended behavior).
-- Updated for brief v3: no more `role` column, whatsapp floor is now $20,
-- plus coverage for the new offer types and the (createur_id, type)
-- uniqueness constraint that backs the conversational settings UI.

insert into users (id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222');

-- ---------------------------------------------------------------------
-- Checklist item 2: a whatsapp offer can never be edited under $20,
-- enforced at the database level on the billed `prix` column.
-- ---------------------------------------------------------------------
insert into offres (id, createur_id, type, prix) values
  ('33333333-3333-3333-3333-333333333333',
   '11111111-1111-1111-1111-111111111111', 'whatsapp', 20);

do $$
begin
  begin
    insert into offres (createur_id, type, prix)
      values ('11111111-1111-1111-1111-111111111111', 'whatsapp', 19.99);
    raise exception 'TEST FAILED: whatsapp offre created at 19.99 (below floor)';
  exception when check_violation then
    raise notice 'PASS: creating a whatsapp offre below $20 is rejected at DB level';
  end;
end $$;

do $$
begin
  begin
    -- Simulates the PATCH route's UPDATE: dropping an existing whatsapp
    -- offer's price below $20 after the fact.
    update offres set prix = 5
      where id = '33333333-3333-3333-3333-333333333333';
    raise exception 'TEST FAILED: whatsapp offre price dropped to 5 via UPDATE';
  exception when check_violation then
    raise notice 'PASS: dropping an existing whatsapp offre below $20 is rejected at DB level';
  end;
end $$;

do $$
begin
  begin
    -- The pitfall from a previous attempt: writing a "safe-looking" value
    -- into the JSON config column must not matter, because the constraint
    -- is on `prix`, never on `config`.
    update offres set prix = 5, config = '{"prix_minimum": 20}'::jsonb
      where id = '33333333-3333-3333-3333-333333333333';
    raise exception 'TEST FAILED: JSON config bypassed the prix floor';
  exception when check_violation then
    raise notice 'PASS: a client-controlled JSON field cannot be used to bypass the prix floor';
  end;
end $$;

do $$
declare
  v_prix numeric;
begin
  select prix into v_prix from offres where id = '33333333-3333-3333-3333-333333333333';
  if v_prix != 20 then
    raise exception 'TEST FAILED: offre prix was mutated to % despite rejected UPDATEs', v_prix;
  end if;
  raise notice 'PASS: offre prix is untouched (still 20) after the rejected UPDATE attempts';
end $$;

-- ---------------------------------------------------------------------
-- Brief v3 point 2/3: the 4 new offer types are accepted, don's prix can
-- be null (and only don's), and a créateur can't have two offres of the
-- same type (the conversational settings UI is one row per type).
-- ---------------------------------------------------------------------
insert into offres (id, createur_id, type, prix) values
  ('77777777-7777-7777-7777-777777777777',
   '11111111-1111-1111-1111-111111111111', 'shoutout', 5),
  ('88888888-8888-8888-8888-888888888888',
   '11111111-1111-1111-1111-111111111111', 'contenu_debloque', 15),
  ('99999999-9999-9999-9999-999999999999',
   '11111111-1111-1111-1111-111111111111', 'evenement_live', 25);

insert into offres (id, createur_id, type, prix) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111', 'don', null);

do $$
begin
  raise notice 'PASS: shoutout/contenu_debloque/evenement_live offres accepted, don with null prix accepted';
end $$;

do $$
begin
  begin
    insert into offres (createur_id, type, prix)
      values ('11111111-1111-1111-1111-111111111111', 'video', null);
    raise exception 'TEST FAILED: video offre created with null prix';
  exception when check_violation then
    raise notice 'PASS: a paid offer type still requires a non-null prix';
  end;
end $$;

do $$
begin
  begin
    -- Same créateur, same type twice.
    insert into offres (createur_id, type, prix)
      values ('11111111-1111-1111-1111-111111111111', 'shoutout', 8);
    raise exception 'TEST FAILED: a second shoutout offre for the same créateur was accepted';
  exception when unique_violation then
    raise notice 'PASS: a créateur can only have one offre per type (unique_offre_type_par_createur)';
  end;
end $$;

do $$
begin
  begin
    insert into offres (createur_id, type, prix)
      values ('11111111-1111-1111-1111-111111111111', 'inexistant', 5);
    raise exception 'TEST FAILED: an unknown offre type was accepted';
  exception when check_violation then
    raise notice 'PASS: an unrecognized offre type is still rejected at DB level';
  end;
end $$;

-- ---------------------------------------------------------------------
-- Brief v3 follow-up: `video` is exempt from the one-offer-per-type rule
-- -- a créateur can list several video offers with different labels/
-- prices ("Anniversaire" at 10$, "Danse" at 15$) -- but every other type
-- (whatsapp/don/contenu_debloque/evenement_live) still strictly enforces
-- one row per type, even though `libelle` is now part of the same
-- constraint (NULLS NOT DISTINCT is what makes that hold for a null
-- libelle, rather than every NULL being treated as unique).
-- ---------------------------------------------------------------------
insert into offres (createur_id, type, prix, libelle) values
  ('11111111-1111-1111-1111-111111111111', 'video', 15, 'Danse');

do $$
begin
  raise notice 'PASS: a second video offre with a distinct libelle is accepted';
end $$;

do $$
begin
  begin
    insert into offres (createur_id, type, prix, libelle)
      values ('11111111-1111-1111-1111-111111111111', 'video', 12, 'Danse');
    raise exception 'TEST FAILED: a second video offre with the SAME libelle was accepted';
  exception when unique_violation then
    raise notice 'PASS: two video offres with the same (créateur, libelle) still conflict';
  end;
end $$;


-- ---------------------------------------------------------------------
-- Checklist item 3: a video transaction the créateur never accepts is
-- auto-refunded once deadline_acceptation passes, with no fan action.
-- ---------------------------------------------------------------------
insert into offres (id, createur_id, type, prix) values
  ('44444444-4444-4444-4444-444444444444',
   '11111111-1111-1111-1111-111111111111', 'video', 10);

insert into transactions (id, fan_id, createur_id, offre_id, montant) values
  ('55555555-5555-5555-5555-555555555555',
   '22222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111',
   '44444444-4444-4444-4444-444444444444', 10);

do $$
declare
  v_deadline timestamptz;
begin
  select deadline_acceptation into v_deadline
    from transactions where id = '55555555-5555-5555-5555-555555555555';
  if v_deadline is null then
    raise exception 'TEST FAILED: deadline_acceptation was not set at transaction creation';
  end if;
  raise notice 'PASS: deadline_acceptation auto-set at creation (%)', v_deadline;
end $$;

-- Simulate time passing with the créateur never responding.
update transactions set deadline_acceptation = now() - interval '1 hour'
  where id = '55555555-5555-5555-5555-555555555555';

select * from process_transaction_deadlines();

do $$
declare
  v_statut text;
begin
  select statut into v_statut from transactions
    where id = '55555555-5555-5555-5555-555555555555';
  if v_statut != 'remboursee' then
    raise exception 'TEST FAILED: expected remboursee after deadline, got %', v_statut;
  end if;
  raise notice 'PASS: transaction never accepted by its deadline was auto-refunded by the cron function';
end $$;

-- ---------------------------------------------------------------------
-- Automatic CinetPay refunds (migration 0014): marking a transaction
-- 'remboursee' must ALWAYS flag it for the operator's manual-refund
-- worklist, regardless of remboursement_cinetpay_actif -- see CLAUDE.md
-- "Automatic CinetPay refunds". This is the DB-level half; the
-- application-level half (src/lib/refunds.ts clearing this once a real
-- CinetPay call is confirmed) is covered by refunds.test.ts, since no
-- HTTP extension exists in this database to call CinetPay from SQL.
-- ---------------------------------------------------------------------
do $$
declare
  v_flag jsonb;
  v_pourcentage jsonb;
begin
  select valeur into v_flag from parametres_plateforme
    where cle = 'remboursement_cinetpay_actif';
  select valeur into v_pourcentage from parametres_plateforme
    where cle = 'remboursement_pourcentage';

  if v_flag is distinct from 'false'::jsonb then
    raise exception 'TEST FAILED: remboursement_cinetpay_actif should default to false, got %', v_flag;
  end if;
  if v_pourcentage is distinct from '100'::jsonb then
    raise exception 'TEST FAILED: remboursement_pourcentage should default to 100, got %', v_pourcentage;
  end if;
  raise notice 'PASS: remboursement_cinetpay_actif defaults to false, remboursement_pourcentage to 100';
end $$;

do $$
declare
  v_necessite boolean;
  v_reference text;
begin
  -- The '55555555' transaction above was just auto-refunded by
  -- process_transaction_deadlines() -- confirm the trigger flagged it.
  select necessite_remboursement_manuel, reference_remboursement_cinetpay
    into v_necessite, v_reference
    from transactions where id = '55555555-5555-5555-5555-555555555555';

  if not v_necessite then
    raise exception 'TEST FAILED: necessite_remboursement_manuel should be true after an automatic refund';
  end if;
  if v_reference is not null then
    raise exception 'TEST FAILED: reference_remboursement_cinetpay should stay null -- no real CinetPay call was ever made from SQL';
  end if;
  raise notice 'PASS: an automatic refund flags necessite_remboursement_manuel and never fabricates a reference';
end $$;

-- A second, unrelated case: a video transaction that WAS accepted (validee)
-- but never delivered must also be refunded once deadline_livraison passes
-- -- the other half of checklist item 3 / brief 0.3.
insert into transactions (id, fan_id, createur_id, offre_id, montant, statut) values
  ('66666666-6666-6666-6666-666666666666',
   '22222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111',
   '44444444-4444-4444-4444-444444444444', 10, 'validee');

update transactions set deadline_livraison = now() - interval '1 hour'
  where id = '66666666-6666-6666-6666-666666666666';

select * from process_transaction_deadlines();

do $$
declare
  v_statut text;
begin
  select statut into v_statut from transactions
    where id = '66666666-6666-6666-6666-666666666666';
  if v_statut != 'remboursee' then
    raise exception 'TEST FAILED: expected remboursee after livraison deadline, got %', v_statut;
  end if;
  raise notice 'PASS: accepted-but-undelivered transaction refunded once deadline_livraison passed';
end $$;

-- ---------------------------------------------------------------------
-- Brief v3 point 1: no RLS policy filters on `role` anymore (the column
-- is gone), and shoutout now shares video's acceptation timing.
-- ---------------------------------------------------------------------
do $$
declare
  v_deadline timestamptz;
begin
  insert into transactions (id, fan_id, createur_id, offre_id, montant)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      '22222222-2222-2222-2222-222222222222',
      '11111111-1111-1111-1111-111111111111',
      '77777777-7777-7777-7777-777777777777', 5);

  select deadline_acceptation into v_deadline
    from transactions where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  if v_deadline is null then
    raise exception 'TEST FAILED: shoutout transaction got no deadline_acceptation';
  end if;
  raise notice 'PASS: shoutout gets a 24h acceptation deadline just like video (%)', v_deadline;
end $$;

-- ---------------------------------------------------------------------
-- Pseudo / public handle: format, case-insensitive uniqueness, reserved
-- words -- all enforced at the DB level (migration 0008), not just in the
-- API route's zod schema.
-- ---------------------------------------------------------------------
update users set pseudo = 'Sergio_1' where id = '11111111-1111-1111-1111-111111111111';

do $$
begin
  begin
    update users set pseudo = 'sergio_1' where id = '22222222-2222-2222-2222-222222222222';
    raise exception 'TEST FAILED: case-insensitive pseudo collision accepted';
  exception when unique_violation then
    raise notice 'PASS: pseudo uniqueness is case-insensitive at the DB level';
  end;
end $$;

do $$
begin
  begin
    update users set pseudo = 'ab' where id = '22222222-2222-2222-2222-222222222222';
    raise exception 'TEST FAILED: a 2-character pseudo was accepted';
  exception when check_violation then
    raise notice 'PASS: pseudo format (length) enforced at the DB level';
  end;
end $$;

do $$
begin
  begin
    update users set pseudo = 'Dashboard' where id = '22222222-2222-2222-2222-222222222222';
    raise exception 'TEST FAILED: a reserved word was accepted as pseudo';
  exception when check_violation then
    raise notice 'PASS: reserved-word blacklist enforced case-insensitively at the DB level';
  end;
end $$;

-- ---------------------------------------------------------------------
-- Réactivité tracking + classement views: accept_transaction actually
-- records when the créateur responded, and the (rank-only, no
-- underlying counts) classement views only include opted-in users.
-- ---------------------------------------------------------------------
update users set classement_public = true where id = '11111111-1111-1111-1111-111111111111';

-- Uses the stub's auth.uid() session variable (app.current_user_id --
-- see supabase/tests/stub_auth.sql), NOT the real project's
-- request.jwt.claim.sub, which is a separate convention only the real
-- Supabase auth.uid() reads.
select set_config('app.current_user_id', '11111111-1111-1111-1111-111111111111', false);
select accept_transaction('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
select set_config('app.current_user_id', '', false);

do $$
declare
  v_statut text;
  v_repondu_at timestamptz;
begin
  select statut, repondu_at into v_statut, v_repondu_at
    from transactions where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  if v_statut != 'validee' then
    raise exception 'TEST FAILED: accept_transaction did not validate the shoutout transaction (statut=%)', v_statut;
  end if;

  if v_repondu_at is null then
    raise exception 'TEST FAILED: accept_transaction did not record repondu_at';
  end if;

  raise notice 'PASS: accept_transaction records repondu_at (%), used by the réactivité leaderboard', v_repondu_at;
end $$;

-- refuse_transaction() is the other path into 'remboursee' (besides the
-- deadline cron) -- must flag necessite_remboursement_manuel exactly the
-- same way, via the same handle_transaction_remboursement trigger.
insert into transactions (id, fan_id, createur_id, offre_id, montant, statut) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc',
   '22222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111',
   '33333333-3333-3333-3333-333333333333', 20, 'en_attente');

select set_config('app.current_user_id', '11111111-1111-1111-1111-111111111111', false);
select refuse_transaction('cccccccc-cccc-cccc-cccc-cccccccccccc');
select set_config('app.current_user_id', '', false);

do $$
declare
  v_statut text;
  v_necessite boolean;
begin
  select statut, necessite_remboursement_manuel into v_statut, v_necessite
    from transactions where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

  if v_statut != 'remboursee' then
    raise exception 'TEST FAILED: refuse_transaction did not mark the transaction remboursee (got %)', v_statut;
  end if;
  if not v_necessite then
    raise exception 'TEST FAILED: refuse_transaction did not flag necessite_remboursement_manuel';
  end if;
  raise notice 'PASS: refuse_transaction also flags necessite_remboursement_manuel';
end $$;

do $$
begin
  if not exists (
    select 1 from classement_volume where createur_id = '11111111-1111-1111-1111-111111111111'
  ) then
    raise exception 'TEST FAILED: opted-in créateur missing from classement_volume';
  end if;

  if exists (
    select 1 from classement_volume where createur_id = '22222222-2222-2222-2222-222222222222'
  ) then
    raise exception 'TEST FAILED: non-opted-in fan appeared in classement_volume';
  end if;

  raise notice 'PASS: classement_volume includes only opted-in users';
end $$;

do $$
declare
  v_columns text;
begin
  select string_agg(column_name, ',') into v_columns
    from information_schema.columns
    where table_schema = 'public' and table_name = 'classement_volume';

  if v_columns ~ 'montant|prix|count|total' then
    raise exception 'TEST FAILED: classement_volume exposes a monetary/count column (%), not rank-only', v_columns;
  end if;

  raise notice 'PASS: classement_volume exposes rank only (%)', v_columns;
end $$;

-- ---------------------------------------------------------------------
-- nom_affichage / explorer (migration 0009): display name, the reserved-
-- word list picking up the new /explorer route, and profils_explorables
-- computing "has an active offre AND not masque_exploration" without
-- ever exposing masque_exploration itself.
-- ---------------------------------------------------------------------
do $$
begin
  begin
    update users set nom_affichage = repeat('x', 61)
      where id = '11111111-1111-1111-1111-111111111111';
    raise exception 'TEST FAILED: a 61-character nom_affichage was accepted';
  exception when check_violation then
    raise notice 'PASS: nom_affichage max length enforced at the DB level';
  end;
end $$;

do $$
begin
  begin
    update users set pseudo = 'explorer' where id = '22222222-2222-2222-2222-222222222222';
    raise exception 'TEST FAILED: the new "explorer" route name was accepted as a pseudo';
  exception when check_violation then
    raise notice 'PASS: "explorer" is rejected as a pseudo (reserved-word list kept in sync with the new route)';
  end;
end $$;

do $$
begin
  begin
    update users set pseudo = 'reinitialiser-mot-de-passe'
      where id = '22222222-2222-2222-2222-222222222222';
    raise exception
      'TEST FAILED: the password-reset route name was accepted as a pseudo';
  exception when check_violation then
    raise notice 'PASS: the password reset routes are rejected as a pseudo (reserved-word list kept in sync)';
  end;
end $$;

do $$
begin
  begin
    update users set pseudo = 'admin' where id = '22222222-2222-2222-2222-222222222222';
    raise exception 'TEST FAILED: the new "admin" route name was accepted as a pseudo';
  exception when check_violation then
    raise notice 'PASS: "admin" is rejected as a pseudo (reserved-word list kept in sync with the new route)';
  end;
end $$;

update users set nom_affichage = 'Sergio le Créateur'
  where id = '11111111-1111-1111-1111-111111111111';

do $$
declare
  v_nom text;
begin
  select nom_affichage into v_nom from profils_publics
    where id = '11111111-1111-1111-1111-111111111111';
  if v_nom != 'Sergio le Créateur' then
    raise exception 'TEST FAILED: profils_publics did not expose nom_affichage (got %)', v_nom;
  end if;
  raise notice 'PASS: profils_publics exposes nom_affichage';
end $$;

do $$
begin
  -- '11111111' has several active offres inserted earlier in this file
  -- (shoutout/contenu_debloque/evenement_live/don/video) and defaults to
  -- masque_exploration = false -- it must appear.
  if not exists (
    select 1 from profils_explorables where id = '11111111-1111-1111-1111-111111111111'
  ) then
    raise exception 'TEST FAILED: créateur with an active offre missing from profils_explorables';
  end if;

  -- '22222222' has never created an offre in this file -- it must not
  -- appear, regardless of masque_exploration.
  if exists (
    select 1 from profils_explorables where id = '22222222-2222-2222-2222-222222222222'
  ) then
    raise exception 'TEST FAILED: créateur with zero active offres appeared in profils_explorables';
  end if;

  raise notice 'PASS: profils_explorables includes only créateurs with at least one active offre';
end $$;

update users set masque_exploration = true
  where id = '11111111-1111-1111-1111-111111111111';

do $$
begin
  if exists (
    select 1 from profils_explorables where id = '11111111-1111-1111-1111-111111111111'
  ) then
    raise exception 'TEST FAILED: masque_exploration=true créateur still appeared in profils_explorables';
  end if;
  raise notice 'PASS: masque_exploration opts a créateur out of profils_explorables even with active offres';
end $$;

do $$
declare
  v_columns text;
begin
  select string_agg(column_name, ',') into v_columns
    from information_schema.columns
    where table_schema = 'public' and table_name = 'profils_explorables';

  if v_columns ~ 'masque_exploration' then
    raise exception 'TEST FAILED: profils_explorables exposes masque_exploration itself (%)', v_columns;
  end if;

  raise notice 'PASS: profils_explorables never exposes masque_exploration (%)', v_columns;
end $$;

-- ---------------------------------------------------------------------
-- Pseudo change cool-down (migration 0010): a real change starts the
-- 30-day clock, a repeat change within that window is blocked even
-- though the underlying users_update_self RLS policy would otherwise let
-- an authenticated user write pseudo_modifie_at directly.
-- ---------------------------------------------------------------------
do $$
begin
  begin
    -- '11111111' had its pseudo set for the first time earlier in this
    -- file (line ~251, 'Sergio_1'), so pseudo_modifie_at is now "recent" --
    -- well within 30 days.
    update users set pseudo = 'Sergio_2' where id = '11111111-1111-1111-1111-111111111111';
    raise exception 'TEST FAILED: pseudo changed again within the 30-day cooldown';
  exception when sqlstate 'FB001' then
    raise notice 'PASS: a second pseudo change within 30 days of the first is rejected at the DB level';
  end;
end $$;

do $$
declare
  v_pseudo text;
begin
  select pseudo into v_pseudo from users where id = '11111111-1111-1111-1111-111111111111';
  if v_pseudo != 'Sergio_1' then
    raise exception 'TEST FAILED: pseudo was mutated to % despite the rejected UPDATE', v_pseudo;
  end if;
  raise notice 'PASS: pseudo is untouched (still Sergio_1) after the rejected cooldown UPDATE';
end $$;

do $$
begin
  begin
    -- Attempting to backdate pseudo_modifie_at directly (without also
    -- changing pseudo) must not be able to manufacture an early unlock --
    -- the trigger forces it back to its previous value regardless.
    update users set pseudo_modifie_at = now() - interval '31 days'
      where id = '11111111-1111-1111-1111-111111111111';

    update users set pseudo = 'Sergio_3' where id = '11111111-1111-1111-1111-111111111111';
    raise exception 'TEST FAILED: backdating pseudo_modifie_at directly bypassed the cooldown';
  exception when sqlstate 'FB001' then
    raise notice 'PASS: directly writing pseudo_modifie_at cannot be used to bypass the cooldown';
  end;
end $$;

-- '22222222' has never had a pseudo set (every earlier attempt in this
-- file failed and rolled back) -- the very first real change must be
-- allowed immediately, with no prior pseudo_modifie_at to compare against.
update users set pseudo = 'marie_first' where id = '22222222-2222-2222-2222-222222222222';

do $$
declare
  v_pseudo text;
  v_modifie_at timestamptz;
begin
  select pseudo, pseudo_modifie_at into v_pseudo, v_modifie_at
    from users where id = '22222222-2222-2222-2222-222222222222';

  if v_pseudo != 'marie_first' then
    raise exception 'TEST FAILED: first-ever pseudo change was rejected';
  end if;
  if v_modifie_at is null then
    raise exception 'TEST FAILED: pseudo_modifie_at was not set on the first real pseudo change';
  end if;

  raise notice 'PASS: a créateur''s first-ever pseudo change is allowed immediately and starts the cooldown';
end $$;

-- Simulate 31 days having passed since the last change (as the test
-- harness, not as a user -- see the bypass-attempt test above for why a
-- normal UPDATE can't do this) and confirm the cooldown has cleared.
alter table users disable trigger trg_enforce_pseudo_cooldown;
update users set pseudo_modifie_at = now() - interval '31 days'
  where id = '11111111-1111-1111-1111-111111111111';
alter table users enable trigger trg_enforce_pseudo_cooldown;

update users set pseudo = 'Sergio_4' where id = '11111111-1111-1111-1111-111111111111';

do $$
declare
  v_pseudo text;
begin
  select pseudo into v_pseudo from users where id = '11111111-1111-1111-1111-111111111111';
  if v_pseudo != 'Sergio_4' then
    raise exception 'TEST FAILED: pseudo change was still blocked once 30 days had elapsed (got %)', v_pseudo;
  end if;
  raise notice 'PASS: pseudo change is allowed again once 30 days have elapsed';
end $$;

-- ---------------------------------------------------------------------
-- Province/ville (migration 0012): both optional, max-length enforced at
-- the DB level (there's no server API route in front of signup to check
-- this in first -- signup calls supabase.auth.signUp() directly from the
-- browser), and handle_new_auth_user actually picks both up from
-- raw_user_meta_data the same way it already does for telephone/pays.
-- ---------------------------------------------------------------------
do $$
begin
  begin
    update users set province = repeat('x', 101)
      where id = '11111111-1111-1111-1111-111111111111';
    raise exception 'TEST FAILED: a 101-character province was accepted';
  exception when check_violation then
    raise notice 'PASS: province max length enforced at the DB level';
  end;
end $$;

do $$
begin
  begin
    update users set ville = repeat('x', 101)
      where id = '11111111-1111-1111-1111-111111111111';
    raise exception 'TEST FAILED: a 101-character ville was accepted';
  exception when check_violation then
    raise notice 'PASS: ville max length enforced at the DB level';
  end;
end $$;

insert into auth.users (id, raw_user_meta_data)
values (
  '99999999-9999-9999-9999-999999999999',
  jsonb_build_object(
    'telephone', '+243900000099',
    'pays', 'RD Congo',
    'province', 'Kinshasa',
    'ville', 'Gombe'
  )
);

do $$
declare
  v_province text;
  v_ville text;
begin
  select province, ville into v_province, v_ville from users
    where id = '99999999-9999-9999-9999-999999999999';
  if v_province != 'Kinshasa' or v_ville != 'Gombe' then
    raise exception
      'TEST FAILED: handle_new_auth_user did not pick up province/ville from raw_user_meta_data (got province=%, ville=%)',
      v_province, v_ville;
  end if;
  raise notice 'PASS: handle_new_auth_user stores province and ville from signup metadata';
end $$;

insert into auth.users (id, raw_user_meta_data)
values (
  '88888888-8888-8888-8888-888888888888',
  jsonb_build_object('telephone', '+243900000088', 'pays', 'RD Congo')
);

do $$
declare
  v_province text;
  v_ville text;
begin
  select province, ville into v_province, v_ville from users
    where id = '88888888-8888-8888-8888-888888888888';
  if v_province is not null or v_ville is not null then
    raise exception
      'TEST FAILED: province/ville should default to null when omitted from signup metadata (got province=%, ville=%)',
      v_province, v_ville;
  end if;
  raise notice 'PASS: province and ville are optional -- omitting them at signup leaves both null';
end $$;

-- ---------------------------------------------------------------------
-- Admin role (migration 0015): a normal user can never self-promote via
-- a direct UPDATE (users_update_self's RLS lets a user PATCH their own
-- row's *any* column, the same gap already closed for pseudo_modifie_at
-- in 0010), only an existing admin can grant/revoke someone else's
-- status via the SECURITY DEFINER RPC, and marking a manual refund as
-- handled never fabricates a fake automated-refund confirmation.
-- ---------------------------------------------------------------------
-- '22222222' has never been admin anywhere in this file up to this point.
-- ATTACK: self-promote via a direct UPDATE, as itself.
select set_config('app.current_user_id', '22222222-2222-2222-2222-222222222222', false);
update users set est_admin = true where id = '22222222-2222-2222-2222-222222222222';
select set_config('app.current_user_id', '', false);

do $$
declare
  v_est_admin boolean;
begin
  select est_admin into v_est_admin from users where id = '22222222-2222-2222-2222-222222222222';
  if v_est_admin then
    raise exception 'TEST FAILED: a normal user was able to self-promote to admin via a direct UPDATE';
  end if;
  raise notice 'PASS: a normal user cannot self-promote via a direct UPDATE (RLS would otherwise allow it, same class of bug as pseudo_modifie_at backdating)';
end $$;

-- Bootstrap the first admin: no app.current_user_id set at all (mirrors a
-- direct SQL Editor session or this migration itself, not an authenticated
-- PostgREST request) -- the trigger's auth.uid() is null exemption is what
-- makes this possible without disabling the trigger.
update users set est_admin = true where id = '11111111-1111-1111-1111-111111111111';

do $$
declare
  v_est_admin boolean;
begin
  select est_admin into v_est_admin from users where id = '11111111-1111-1111-1111-111111111111';
  if not v_est_admin then
    raise exception 'TEST FAILED: bootstrapping the first admin via a no-auth-context UPDATE did not work';
  end if;
  raise notice 'PASS: the first admin can be bootstrapped via a direct UPDATE with no auth.uid() context';
end $$;

-- '11111111' (now admin) grants admin to '22222222' via the RPC.
select set_config('app.current_user_id', '11111111-1111-1111-1111-111111111111', false);
select set_admin_status('22222222-2222-2222-2222-222222222222', true);
select set_config('app.current_user_id', '', false);

do $$
declare
  v_est_admin boolean;
begin
  select est_admin into v_est_admin from users where id = '22222222-2222-2222-2222-222222222222';
  if not v_est_admin then
    raise exception 'TEST FAILED: an existing admin could not grant admin status to another user via set_admin_status';
  end if;
  raise notice 'PASS: an existing admin can grant admin status to another user via set_admin_status';
end $$;

-- '22222222' (now admin) revokes '11111111''s admin status via the RPC.
select set_config('app.current_user_id', '22222222-2222-2222-2222-222222222222', false);
select set_admin_status('11111111-1111-1111-1111-111111111111', false);
select set_config('app.current_user_id', '', false);

do $$
declare
  v_est_admin boolean;
begin
  select est_admin into v_est_admin from users where id = '11111111-1111-1111-1111-111111111111';
  if v_est_admin then
    raise exception 'TEST FAILED: set_admin_status did not actually revoke admin status';
  end if;
  raise notice 'PASS: an existing admin can revoke another admin''s status via set_admin_status';
end $$;

-- ATTACK: '11111111' (no longer admin) tries to re-grant itself via the
-- RPC directly -- must be rejected, not just silently no-op.
select set_config('app.current_user_id', '11111111-1111-1111-1111-111111111111', false);

do $$
begin
  perform set_admin_status('11111111-1111-1111-1111-111111111111', true);
  raise exception 'TEST FAILED: a non-admin was able to call set_admin_status to self-promote';
exception when others then
  if sqlerrm != 'not authorized' then
    raise;
  end if;
  raise notice 'PASS: set_admin_status rejects a non-admin caller (self-promotion attempt via the RPC)';
end $$;

select set_config('app.current_user_id', '', false);

-- mark_remboursement_manuel_traite: uses the existing whatsapp offre
-- ('33333333', créateur '11111111', see near the top of this file).
insert into transactions (id, fan_id, createur_id, offre_id, montant, statut, necessite_remboursement_manuel)
values (
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  '22222222-2222-2222-2222-222222222222',
  '11111111-1111-1111-1111-111111111111',
  '33333333-3333-3333-3333-333333333333',
  20, 'remboursee', true
);

-- '11111111' is not admin at this point (revoked above) -- must be rejected.
select set_config('app.current_user_id', '11111111-1111-1111-1111-111111111111', false);

do $$
begin
  perform mark_remboursement_manuel_traite('dddddddd-dddd-dddd-dddd-dddddddddddd');
  raise exception 'TEST FAILED: a non-admin was able to call mark_remboursement_manuel_traite';
exception when others then
  if sqlerrm != 'not authorized' then
    raise;
  end if;
  raise notice 'PASS: mark_remboursement_manuel_traite rejects a non-admin caller';
end $$;

select set_config('app.current_user_id', '', false);

-- '22222222' is admin -- marking it treated must succeed.
select set_config('app.current_user_id', '22222222-2222-2222-2222-222222222222', false);
select mark_remboursement_manuel_traite('dddddddd-dddd-dddd-dddd-dddddddddddd');
select set_config('app.current_user_id', '', false);

do $$
declare
  v_necessite boolean;
  v_reference text;
  v_montant numeric;
begin
  select necessite_remboursement_manuel, reference_remboursement_cinetpay, montant_rembourse
    into v_necessite, v_reference, v_montant
    from transactions where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

  if v_necessite then
    raise exception 'TEST FAILED: mark_remboursement_manuel_traite did not clear necessite_remboursement_manuel';
  end if;
  if v_reference is not null or v_montant is not null then
    raise exception
      'TEST FAILED: mark_remboursement_manuel_traite fabricated an automated-refund confirmation (reference=%, montant=%)',
      v_reference, v_montant;
  end if;
  raise notice 'PASS: mark_remboursement_manuel_traite clears the worklist flag without fabricating an automated-refund confirmation';
end $$;

do $$
begin
  raise notice 'ALL SQL CHECKLIST TESTS PASSED';
end $$;
