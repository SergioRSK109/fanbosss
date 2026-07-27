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
-- Commission rate (migration 0024): 15% HT + TVA (16%) répercutée au
-- créateur, not the previous 17%-absorbed model (migration 0018).
-- frais_agregateur is still computed and stored for bookkeeping and
-- still absorbed by the platform (unchanged), but tva is now deducted
-- from the créateur's share again, alongside the commission itself --
-- standard marketplace-intermediation model. Verified with a real
-- transaction reaching 'validee' (the moment
-- create_paiement_on_validation() actually fires), not just read from
-- the function's source.
-- ---------------------------------------------------------------------
insert into transactions (id, fan_id, createur_id, offre_id, montant, statut) values
  ('ffffffff-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111',
   '33333333-3333-3333-3333-333333333333', 100, 'en_attente');

update transactions set statut = 'validee'
  where id = 'ffffffff-1111-1111-1111-111111111111';

do $$
declare
  v_commission numeric;
  v_frais numeric;
  v_tva numeric;
  v_net numeric;
begin
  select commission_plateforme, frais_agregateur, tva, montant_net_createur
    into v_commission, v_frais, v_tva, v_net
    from paiements where transaction_id = 'ffffffff-1111-1111-1111-111111111111';

  if v_commission != 15 then
    raise exception 'TEST FAILED: commission_plateforme was % instead of 15 (100 * 15%% HT)', v_commission;
  end if;
  if v_frais != 3 then
    raise exception 'TEST FAILED: frais_agregateur was % instead of 3 (100 * 3%%, unchanged)', v_frais;
  end if;
  if v_tva != 2.4 then
    raise exception 'TEST FAILED: tva was % instead of 2.4 (15 * 16%%, unchanged formula on the new 15%% commission)', v_tva;
  end if;
  if v_net != 82.6 then
    raise exception
      'TEST FAILED: montant_net_createur was % instead of 82.6 -- commission AND tva must both be deducted from the créateur''s share (15 + 2.4 = 17.4 TTC withheld from 100)',
      v_net;
  end if;
  raise notice 'PASS: create_paiement_on_validation() charges 15%% HT commission + TVA (16%%), both deducted from montant_net_createur (frais_agregateur still absorbed by the platform, unchanged)';
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

-- ---------------------------------------------------------------------
-- Security regression (migration 0020): accept_transaction/
-- refuse_transaction/deliver_video must reject a fully anonymous caller
-- (auth.uid() IS NULL), not silently let one through via `!=`'s NULL
-- semantics -- a real, previously-exploitable bug, reproduced directly
-- against a real Postgres instance (SET ROLE anon; no
-- app.current_user_id at all; a real pending transaction belonging to a
-- different, real créateur got accepted/refused/fake-delivered) before
-- this fix was written. Two independent layers, both tested: (1) `anon`
-- must have no EXECUTE privilege on any of the three functions at all
-- (migration 0020's `revoke all ... from public`); (2) even as
-- `authenticated` (EXECUTE granted), a call with auth.uid() genuinely
-- NULL must still be rejected by the function body itself -- defense in
-- depth, so this stays closed even if EXECUTE were ever mistakenly
-- re-granted to anon/public in the future.
-- ---------------------------------------------------------------------
insert into transactions (id, fan_id, createur_id, offre_id, montant, statut) values
  ('a110ac01-0000-0000-0000-000000000001',
   '22222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111',
   '44444444-4444-4444-4444-444444444444', 10, 'en_attente'),
  ('a110ac02-0000-0000-0000-000000000002',
   '22222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111',
   '44444444-4444-4444-4444-444444444444', 10, 'en_attente'),
  ('a110ac03-0000-0000-0000-000000000003',
   '22222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111',
   '44444444-4444-4444-4444-444444444444', 10, 'validee');

-- Genuinely anonymous: no app.current_user_id at all.
select set_config('app.current_user_id', '', false);

-- Layer 1: anon has no EXECUTE privilege at all -- real Postgres
-- permission check, same technique as mes_progres_classement() above.
set role anon;

do $$
begin
  begin
    perform accept_transaction('a110ac01-0000-0000-0000-000000000001');
    raise exception 'TEST FAILED: anon was able to call accept_transaction() at all';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no EXECUTE privilege on accept_transaction() (migration 0020)';
  end;
end $$;

do $$
begin
  begin
    perform refuse_transaction('a110ac02-0000-0000-0000-000000000002');
    raise exception 'TEST FAILED: anon was able to call refuse_transaction() at all';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no EXECUTE privilege on refuse_transaction() (migration 0020)';
  end;
end $$;

do $$
begin
  begin
    perform deliver_video('a110ac03-0000-0000-0000-000000000003', 'attacker/forged.mp4');
    raise exception 'TEST FAILED: anon was able to call deliver_video() at all';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no EXECUTE privilege on deliver_video() (migration 0020)';
  end;
end $$;

reset role;

-- Layer 2: `authenticated` (EXECUTE granted) but auth.uid() genuinely
-- NULL -- this is the exact scenario that used to succeed silently.
set role authenticated;

do $$
begin
  begin
    perform accept_transaction('a110ac01-0000-0000-0000-000000000001');
    raise exception 'TEST FAILED: accept_transaction() succeeded with auth.uid() IS NULL -- the anonymous-caller bypass is back';
  exception when others then
    if sqlerrm != 'not authenticated' then
      raise exception 'TEST FAILED: unexpected error calling accept_transaction() with a NULL auth.uid(): %', sqlerrm;
    end if;
    raise notice 'PASS: accept_transaction() rejects a call with auth.uid() IS NULL';
  end;
end $$;

do $$
begin
  begin
    perform refuse_transaction('a110ac02-0000-0000-0000-000000000002');
    raise exception 'TEST FAILED: refuse_transaction() succeeded with auth.uid() IS NULL -- the anonymous-caller bypass is back';
  exception when others then
    if sqlerrm != 'not authenticated' then
      raise exception 'TEST FAILED: unexpected error calling refuse_transaction() with a NULL auth.uid(): %', sqlerrm;
    end if;
    raise notice 'PASS: refuse_transaction() rejects a call with auth.uid() IS NULL';
  end;
end $$;

do $$
begin
  begin
    perform deliver_video('a110ac03-0000-0000-0000-000000000003', 'attacker/forged.mp4');
    raise exception 'TEST FAILED: deliver_video() succeeded with auth.uid() IS NULL -- the anonymous-caller bypass is back';
  exception when others then
    if sqlerrm != 'not authenticated' then
      raise exception 'TEST FAILED: unexpected error calling deliver_video() with a NULL auth.uid(): %', sqlerrm;
    end if;
    raise notice 'PASS: deliver_video() rejects a call with auth.uid() IS NULL';
  end;
end $$;

reset role;

-- None of the rejected attacks above should have left any trace.
do $$
declare
  v_statut1 text;
  v_statut2 text;
  v_statut3 text;
  v_livrable jsonb;
begin
  select statut into v_statut1 from transactions where id = 'a110ac01-0000-0000-0000-000000000001';
  select statut into v_statut2 from transactions where id = 'a110ac02-0000-0000-0000-000000000002';
  select statut, livrable into v_statut3, v_livrable from transactions where id = 'a110ac03-0000-0000-0000-000000000003';

  if v_statut1 != 'en_attente' then
    raise exception 'TEST FAILED: accept_transaction attack mutated the transaction despite being rejected (statut=%)', v_statut1;
  end if;
  if v_statut2 != 'en_attente' then
    raise exception 'TEST FAILED: refuse_transaction attack mutated the transaction despite being rejected (statut=%)', v_statut2;
  end if;
  if v_statut3 != 'validee' or v_livrable != '{}'::jsonb then
    raise exception 'TEST FAILED: deliver_video attack mutated the transaction despite being rejected (statut=%, livrable=%)', v_statut3, v_livrable;
  end if;

  raise notice 'PASS: none of the rejected anonymous-caller attacks left any trace on the targeted transactions';
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
-- Signup age gate + nom_affichage from signup (migration 0016): a real
-- 18+ minimum enforced at the DB level -- verified with actual insertion
-- attempts, not assumed to work as written. An under-18 date is
-- rejected, a date one day short of 18 years is rejected (boundary),
-- exactly-18-years-old today is accepted (boundary), and NULL (existing
-- rows predating this column) is unaffected. handle_new_auth_user also
-- starts picking up nom_affichage from signup metadata -- SignupForm.tsx
-- concatenates "{nom} {postnom}" client-side before calling signUp(),
-- so there's no separate nom/postnom column to test here, only that the
-- already-existing nom_affichage column receives it correctly.
-- ---------------------------------------------------------------------
do $$
begin
  begin
    update users set date_naissance = (current_date - interval '17 years')::date
      where id = '11111111-1111-1111-1111-111111111111';
    raise exception 'TEST FAILED: a 17-year-old date_naissance was accepted';
  exception when check_violation then
    raise notice 'PASS: date_naissance rejects an under-18 date (17 years old)';
  end;
end $$;

do $$
begin
  begin
    update users set date_naissance = (current_date - interval '18 years' + interval '1 day')::date
      where id = '11111111-1111-1111-1111-111111111111';
    raise exception 'TEST FAILED: a date one day short of 18 years was accepted';
  exception when check_violation then
    raise notice 'PASS: date_naissance rejects a date one day short of 18 years (boundary)';
  end;
end $$;

do $$
declare
  v_date_naissance date;
begin
  update users set date_naissance = (current_date - interval '18 years')::date
    where id = '11111111-1111-1111-1111-111111111111';
  select date_naissance into v_date_naissance from users
    where id = '11111111-1111-1111-1111-111111111111';
  if v_date_naissance != (current_date - interval '18 years')::date then
    raise exception 'TEST FAILED: an exactly-18-years-old date_naissance was not accepted (got %)', v_date_naissance;
  end if;
  raise notice 'PASS: date_naissance accepts exactly 18 years old today (boundary)';
end $$;

do $$
begin
  update users set date_naissance = null
    where id = '11111111-1111-1111-1111-111111111111';
  raise notice 'PASS: date_naissance accepts NULL (existing accounts predating this column)';
end $$;

insert into auth.users (id, raw_user_meta_data)
values (
  '77777777-7777-7777-7777-777777777777',
  jsonb_build_object(
    'telephone', '+243900000077',
    'pays', 'RD Congo',
    'nom_affichage', 'Jean Kabila',
    'date_naissance', (current_date - interval '25 years')::date::text
  )
);

do $$
declare
  v_nom_affichage text;
  v_date_naissance date;
begin
  select nom_affichage, date_naissance into v_nom_affichage, v_date_naissance from users
    where id = '77777777-7777-7777-7777-777777777777';
  if v_nom_affichage != 'Jean Kabila' then
    raise exception 'TEST FAILED: handle_new_auth_user did not pick up nom_affichage from signup metadata (got %)', v_nom_affichage;
  end if;
  if v_date_naissance != (current_date - interval '25 years')::date then
    raise exception 'TEST FAILED: handle_new_auth_user did not pick up date_naissance from signup metadata (got %)', v_date_naissance;
  end if;
  raise notice 'PASS: handle_new_auth_user stores nom_affichage and date_naissance from signup metadata';
end $$;

insert into auth.users (id, raw_user_meta_data)
values (
  '66666666-6666-6666-6666-666666666666',
  jsonb_build_object('telephone', '+243900000066', 'pays', 'RD Congo')
);

do $$
declare
  v_nom_affichage text;
  v_date_naissance date;
begin
  select nom_affichage, date_naissance into v_nom_affichage, v_date_naissance from users
    where id = '66666666-6666-6666-6666-666666666666';
  if v_nom_affichage is not null or v_date_naissance is not null then
    raise exception
      'TEST FAILED: nom_affichage/date_naissance should default to null when omitted from signup metadata (got nom_affichage=%, date_naissance=%)',
      v_nom_affichage, v_date_naissance;
  end if;
  raise notice 'PASS: nom_affichage and date_naissance are optional at the trigger level -- omitting them leaves both null';
end $$;

-- The trigger must also reject an under-18 signup end-to-end -- this is
-- the exact path a real signup takes (an INSERT into auth.users, not a
-- direct UPDATE on an existing users row), and the failure must roll
-- back the auth.users row too, not leave a half-created account behind.
do $$
begin
  begin
    insert into auth.users (id, raw_user_meta_data)
    values (
      '55555555-5555-5555-5555-555555555555',
      jsonb_build_object(
        'telephone', '+243900000055',
        'pays', 'RD Congo',
        'date_naissance', (current_date - interval '17 years')::date::text
      )
    );
    raise exception 'TEST FAILED: an under-18 signup was accepted end-to-end via handle_new_auth_user';
  exception when check_violation then
    raise notice 'PASS: an under-18 signup is rejected end-to-end via handle_new_auth_user';
  end;
end $$;

do $$
declare
  v_count integer;
begin
  select count(*) into v_count from auth.users where id = '55555555-5555-5555-5555-555555555555';
  if v_count != 0 then
    raise exception 'TEST FAILED: the rejected under-18 signup left a row behind in auth.users';
  end if;
  raise notice 'PASS: the rejected under-18 signup left no row behind in auth.users (whole statement rolled back)';
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

-- ---------------------------------------------------------------------
-- Fundraising campaigns (migration 0017): both auto-close paths,
-- verified with real inserts/updates -- not assumed to work as written.
-- Reaching the objectif closes the campaign immediately via a
-- transactions trigger; separately, close_expired_campagnes() (the cron
-- RPC) closes any campaign whose date_fin has passed without reaching
-- it, while leaving every other campaign (goal not reached, no
-- date_fin, or date_fin still in the future/today) untouched. Also
-- covers campagnes_montant_collecte's live sum and the deliberate
-- difference between campagnes_publiques (never actif-filtered, so
-- closed campaigns stay visible as history) and offres_publiques
-- (still actif-filtered, exactly like every other offer type).
-- ---------------------------------------------------------------------

insert into users (id, telephone, pays) values
  ('eeeeeee1-1111-1111-1111-111111111111', '+243900000101', 'RDC'),
  ('eeeeeee2-2222-2222-2222-222222222222', '+243900000102', 'RDC');

-- Campaign 1: goal-reached path.
insert into offres (id, createur_id, type, libelle, config, actif)
values (
  'eeeeeee3-3333-3333-3333-333333333333',
  'eeeeeee1-1111-1111-1111-111111111111',
  'campagne', 'Toit pour l''église',
  jsonb_build_object('description', 'Réparer le toit', 'objectif', 100),
  true
);

-- First contribution: below goal, must stay active.
insert into transactions (id, fan_id, createur_id, offre_id, montant, statut)
values (
  'eeeeeee6-6666-6666-6666-666666666666',
  'eeeeeee2-2222-2222-2222-222222222222',
  'eeeeeee1-1111-1111-1111-111111111111',
  'eeeeeee3-3333-3333-3333-333333333333',
  40, 'en_attente'
);
update transactions set statut = 'validee' where id = 'eeeeeee6-6666-6666-6666-666666666666';
update transactions set statut = 'livree' where id = 'eeeeeee6-6666-6666-6666-666666666666';

do $$
declare
  v_actif boolean;
begin
  select actif into v_actif from offres where id = 'eeeeeee3-3333-3333-3333-333333333333';
  if not v_actif then
    raise exception 'TEST FAILED: the campaign closed before reaching its objectif (40/100)';
  end if;
  raise notice 'PASS: a campagne stays active while its collected total is below the objectif';
end $$;

do $$
declare
  v_collecte numeric;
begin
  select montant_collecte into v_collecte from campagnes_montant_collecte
    where offre_id = 'eeeeeee3-3333-3333-3333-333333333333';
  if v_collecte != 40 then
    raise exception 'TEST FAILED: campagnes_montant_collecte reported % instead of 40', v_collecte;
  end if;
  raise notice 'PASS: campagnes_montant_collecte reflects the live sum of delivered contributions';
end $$;

-- Second contribution: pushes the total to exactly the objectif -- must
-- auto-close immediately.
insert into transactions (id, fan_id, createur_id, offre_id, montant, statut)
values (
  'eeeeeee7-7777-7777-7777-777777777777',
  'eeeeeee2-2222-2222-2222-222222222222',
  'eeeeeee1-1111-1111-1111-111111111111',
  'eeeeeee3-3333-3333-3333-333333333333',
  60, 'en_attente'
);
update transactions set statut = 'validee' where id = 'eeeeeee7-7777-7777-7777-777777777777';
update transactions set statut = 'livree' where id = 'eeeeeee7-7777-7777-7777-777777777777';

do $$
declare
  v_actif boolean;
begin
  select actif into v_actif from offres where id = 'eeeeeee3-3333-3333-3333-333333333333';
  if v_actif then
    raise exception 'TEST FAILED: the campaign did not auto-close after reaching its objectif (100/100)';
  end if;
  raise notice 'PASS: a campagne auto-closes (actif=false) the instant a contribution reaches its objectif';
end $$;

do $$
declare
  v_count integer;
begin
  select count(*) into v_count from campagnes_publiques
    where id = 'eeeeeee3-3333-3333-3333-333333333333';
  if v_count != 1 then
    raise exception 'TEST FAILED: a closed campagne disappeared from campagnes_publiques';
  end if;
  raise notice 'PASS: a closed (actif=false) campagne stays visible in campagnes_publiques for public history';
end $$;

do $$
declare
  v_count integer;
begin
  select count(*) into v_count from offres_publiques
    where id = 'eeeeeee3-3333-3333-3333-333333333333';
  if v_count != 0 then
    raise exception 'TEST FAILED: a closed campagne is still showing in offres_publiques (should only ever show active offres there)';
  end if;
  raise notice 'PASS: offres_publiques (unlike campagnes_publiques) still hides a closed campagne, exactly like every other inactive offer type';
end $$;

-- Campaign 2: date_fin already passed, objectif never reached -- must be
-- closed by close_expired_campagnes(), not by the goal-reached trigger.
insert into offres (id, createur_id, type, libelle, config, actif)
values (
  'eeeeeee4-4444-4444-4444-444444444444',
  'eeeeeee1-1111-1111-1111-111111111111',
  'campagne', 'Campagne expirée',
  jsonb_build_object(
    'description', 'x', 'objectif', 1000,
    'date_fin', (current_date - interval '1 day')::date::text
  ),
  true
);

-- Campaign 3 (control): date_fin is today -- must remain untouched (open
-- through the entirety of its own date_fin day, not closed the moment
-- that day starts).
insert into offres (id, createur_id, type, libelle, config, actif)
values (
  'eeeeeee5-5555-5555-5555-555555555555',
  'eeeeeee1-1111-1111-1111-111111111111',
  'campagne', 'Campagne se termine aujourd''hui',
  jsonb_build_object('description', 'x', 'objectif', 1000, 'date_fin', current_date::text),
  true
);

select close_expired_campagnes();

do $$
declare
  v_actif_expiree boolean;
  v_actif_aujourdhui boolean;
begin
  select actif into v_actif_expiree from offres where id = 'eeeeeee4-4444-4444-4444-444444444444';
  select actif into v_actif_aujourdhui from offres where id = 'eeeeeee5-5555-5555-5555-555555555555';

  if v_actif_expiree then
    raise exception 'TEST FAILED: close_expired_campagnes did not close a campagne past its date_fin';
  end if;
  if not v_actif_aujourdhui then
    raise exception 'TEST FAILED: close_expired_campagnes incorrectly closed a campagne whose date_fin is still today';
  end if;
  raise notice 'PASS: close_expired_campagnes closes only campagnes whose date_fin has strictly passed';
end $$;

-- ---------------------------------------------------------------------
-- Private progress-towards-leaderboard (migration 0019):
-- mes_progres_classement() exposes real counts/gaps -- unlike the public
-- classement_* views (rank only) -- so it must be strictly self-only.
--
-- There is no `create policy` here: Postgres row-security policies only
-- ever attach to tables, never to views or functions, and this function
-- inherently needs to read every opted-in créateur's transactions to
-- compute the top-10 threshold -- something a genuine RLS-respecting
-- view could never do under the existing per-user `transactions` SELECT
-- policy. The real guarantee is structural instead: there is no
-- parameter anywhere in this function for a caller to name a different
-- target user (same shape as accept_transaction/refuse_transaction/
-- set_admin_status), and EXECUTE is granted only to `authenticated`,
-- never `anon`. Both are verified below via SET ROLE -- a real Postgres
-- permission check, not just application-level logic.
-- ---------------------------------------------------------------------

-- Isolate this section from classement_public state set earlier in this
-- file (e.g. line ~381), so the top-10 pool built below is exactly what
-- this section creates -- nothing left over from an earlier test leaks
-- into the threshold computation.
update users set classement_public = false where classement_public = true;

insert into users (id, date_creation) values
  ('faceb001-0001-0001-0001-000000000001', now()),                    -- "me": the calling créateur
  ('faceb001-0002-0002-0002-000000000002', now() - interval '40 days'), -- opted-in but too old for progression
  ('faceb001-0003-0003-0003-000000000003', now()),                    -- fan, sends every transaction below
  ('faceb001-0011-0011-0011-000000000011', now()),
  ('faceb001-0012-0012-0012-000000000012', now()),
  ('faceb001-0013-0013-0013-000000000013', now()),
  ('faceb001-0014-0014-0014-000000000014', now()),
  ('faceb001-0015-0015-0015-000000000015', now()),
  ('faceb001-0016-0016-0016-000000000016', now()),
  ('faceb001-0017-0017-0017-000000000017', now()),
  ('faceb001-0018-0018-0018-000000000018', now()),
  ('faceb001-0019-0019-0019-000000000019', now()),
  ('faceb001-0020-0020-0020-000000000020', now());

update users set classement_public = true where id in (
  'faceb001-0001-0001-0001-000000000001',
  'faceb001-0002-0002-0002-000000000002',
  'faceb001-0011-0011-0011-000000000011',
  'faceb001-0012-0012-0012-000000000012',
  'faceb001-0013-0013-0013-000000000013',
  'faceb001-0014-0014-0014-000000000014',
  'faceb001-0015-0015-0015-000000000015',
  'faceb001-0016-0016-0016-000000000016',
  'faceb001-0017-0017-0017-000000000017',
  'faceb001-0018-0018-0018-000000000018',
  'faceb001-0019-0019-0019-000000000019',
  'faceb001-0020-0020-0020-000000000020'
);

-- 'classement' reserved pseudo (new /classement route): a fresh user
-- with no prior pseudo change, so this exercises the reserved-word CHECK
-- constraint itself rather than tripping the (unrelated) cooldown gate
-- an already-pseudo'd user like 11111111/22222222 would hit by this
-- point in the file.
do $$
begin
  begin
    update users set pseudo = 'Classement' where id = 'faceb001-0003-0003-0003-000000000003';
    raise exception 'TEST FAILED: the new "classement" route name was accepted as a pseudo';
  exception when check_violation then
    raise notice 'PASS: "classement" is rejected as a pseudo (reserved-word list kept in sync with the new route)';
  end;
end $$;

-- 10 competitors with delivered-don counts 10,9,8,...,1 -- "me" has 0.
-- Combined pool (11 opted-in créateurs with a livree count, plus the
-- too-old one at 0): sorted desc, the 10th value is 1 -- so "me" is
-- exactly 1 transaction short of the top 10, and the créateur with
-- count=1 already sits exactly at the threshold (already qualifies).
do $$
declare
  v_competiteurs uuid[] := array[
    'faceb001-0011-0011-0011-000000000011',
    'faceb001-0012-0012-0012-000000000012',
    'faceb001-0013-0013-0013-000000000013',
    'faceb001-0014-0014-0014-000000000014',
    'faceb001-0015-0015-0015-000000000015',
    'faceb001-0016-0016-0016-000000000016',
    'faceb001-0017-0017-0017-000000000017',
    'faceb001-0018-0018-0018-000000000018',
    'faceb001-0019-0019-0019-000000000019',
    'faceb001-0020-0020-0020-000000000020'
  ]::uuid[];
  v_counts int[] := array[10,9,8,7,6,5,4,3,2,1];
  v_offre_id uuid;
  i int;
  j int;
begin
  for i in 1..array_length(v_competiteurs, 1) loop
    v_offre_id := gen_random_uuid();
    insert into offres (id, createur_id, type) values (v_offre_id, v_competiteurs[i], 'don');
    for j in 1..v_counts[i] loop
      insert into transactions (fan_id, createur_id, offre_id, montant, statut, created_at)
      values (
        'faceb001-0003-0003-0003-000000000003', v_competiteurs[i], v_offre_id,
        10, 'livree', now()
      );
    end loop;
  end loop;
end $$;

-- "me" has one video transaction already responded to (~5 minutes),
-- so réactivité has real data -- but since nobody else in this pool has
-- any qualifying (video/shoutout/whatsapp) response at all, the
-- réactivité threshold pool is too small for a real 10th place, and
-- "me" auto-qualifies (manque = 0) despite having a real, non-null
-- average.
insert into offres (id, createur_id, type, prix)
  values ('faceb001-0001-0001-0001-0000000000aa', 'faceb001-0001-0001-0001-000000000001', 'video', 15);

insert into transactions (fan_id, createur_id, offre_id, montant, statut, created_at, repondu_at)
values (
  'faceb001-0003-0003-0003-000000000003', 'faceb001-0001-0001-0001-000000000001',
  'faceb001-0001-0001-0001-0000000000aa', 15, 'validee',
  now() - interval '5 minutes', now()
);

-- Real Postgres permission check: anon has no EXECUTE grant at all.
set role anon;
do $$
begin
  begin
    perform 1 from mes_progres_classement();
    raise exception 'TEST FAILED: anon was able to execute mes_progres_classement()';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no EXECUTE privilege on mes_progres_classement() (real Postgres permission check, not just app logic)';
  end;
end $$;
reset role;

set role authenticated;

-- authenticated with no auth.uid() at all (no app.current_user_id set).
select set_config('app.current_user_id', '', false);
do $$
begin
  begin
    perform 1 from mes_progres_classement();
    raise exception 'TEST FAILED: mes_progres_classement() succeeded with no authenticated user';
  exception when others then
    if sqlerrm != 'not authenticated' then
      raise exception 'TEST FAILED: unexpected error with no auth.uid(): %', sqlerrm;
    end if;
    raise notice 'PASS: mes_progres_classement() rejects a call with no auth.uid()';
  end;
end $$;

-- "me": the real numbers behind the rank.
select set_config('app.current_user_id', 'faceb001-0001-0001-0001-000000000001', false);
do $$
declare
  v_row record;
begin
  select * into v_row from mes_progres_classement();

  if v_row.volume_actuel != 0 then
    raise exception 'TEST FAILED: expected volume_actuel=0 for "me", got %', v_row.volume_actuel;
  end if;
  if v_row.volume_seuil_top10 != 1 then
    raise exception 'TEST FAILED: expected volume_seuil_top10=1, got %', v_row.volume_seuil_top10;
  end if;
  if v_row.volume_manque != 1 then
    raise exception 'TEST FAILED: expected volume_manque=1 (exactly 1 short of the top 10), got %', v_row.volume_manque;
  end if;
  if v_row.reactivite_actuelle_secondes is null
     or abs(v_row.reactivite_actuelle_secondes - 300) > 5 then
    raise exception 'TEST FAILED: expected reactivite_actuelle_secondes ~300, got %', v_row.reactivite_actuelle_secondes;
  end if;
  if v_row.reactivite_manque_secondes != 0 then
    raise exception 'TEST FAILED: expected reactivite_manque_secondes=0 (pool too small for a real 10th place), got %', v_row.reactivite_manque_secondes;
  end if;
  if v_row.progression_eligible is not true then
    raise exception 'TEST FAILED: expected progression_eligible=true for a brand-new account';
  end if;
  if v_row.progression_manque != 1 then
    raise exception 'TEST FAILED: expected progression_manque=1, got %', v_row.progression_manque;
  end if;

  raise notice 'PASS: mes_progres_classement() computes correct real numbers (counts, threshold, gap) for the calling créateur';
end $$;

-- A different opted-in créateur, in the same run: must see their OWN
-- numbers, never "me"'s -- this is the actual self-only guarantee the
-- brief asked to prove.
select set_config('app.current_user_id', 'faceb001-0020-0020-0020-000000000020', false);
do $$
declare
  v_row record;
begin
  select * into v_row from mes_progres_classement();

  if v_row.volume_actuel != 1 then
    raise exception 'TEST FAILED: expected volume_actuel=1 for this competitor, got %', v_row.volume_actuel;
  end if;
  if v_row.volume_actuel = 0 then
    raise exception 'TEST FAILED: this competitor session saw "me"''s volume_actuel instead of their own';
  end if;
  if v_row.volume_manque != 0 then
    raise exception 'TEST FAILED: expected volume_manque=0 (already at the threshold), got %', v_row.volume_manque;
  end if;
  if v_row.reactivite_actuelle_secondes is not null then
    raise exception 'TEST FAILED: expected null reactivite_actuelle_secondes (no qualifying response for this créateur), got %', v_row.reactivite_actuelle_secondes;
  end if;

  raise notice 'PASS: a different opted-in créateur sees only their own real numbers, never another créateur''s';
end $$;

-- An account older than 30 days: eligible for volume, correctly excluded
-- from progression (null, not a misleading 0).
select set_config('app.current_user_id', 'faceb001-0002-0002-0002-000000000002', false);
do $$
declare
  v_row record;
begin
  select * into v_row from mes_progres_classement();

  if v_row.progression_eligible is not false then
    raise exception 'TEST FAILED: expected progression_eligible=false for an account older than 30 days';
  end if;
  if v_row.progression_actuel is not null or v_row.progression_manque is not null then
    raise exception 'TEST FAILED: expected null progression numbers for an ineligible account';
  end if;
  if v_row.volume_seuil_top10 != 1 then
    raise exception 'TEST FAILED: volume is unaffected by account age -- expected volume_seuil_top10=1, got %', v_row.volume_seuil_top10;
  end if;

  raise notice 'PASS: an account older than 30 days is excluded from progression (null, not a misleading number) while volume is unaffected';
end $$;

select set_config('app.current_user_id', '', false);
reset role;

-- ---------------------------------------------------------------------
-- SECURITY DEFINER grant audit (migration 0021), triggered by finding
-- the migration 0020 bug: process_transaction_deadlines()/
-- close_expired_campagnes() must be service_role-only (no legitimate
-- authenticated-user or anonymous caller should ever invoke these global
-- sweeps directly), and set_admin_status()/
-- mark_remboursement_manuel_traite() must not be callable by anon either
-- -- defense in depth, since their own internal check already correctly
-- rejects an anonymous caller (see migration 0021's comment for why that
-- check was never actually vulnerable the way accept_transaction's was).
-- ---------------------------------------------------------------------
insert into transactions (id, fan_id, createur_id, offre_id, montant, statut) values
  ('a0d17001-0000-0000-0000-000000000001',
   '22222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111',
   '44444444-4444-4444-4444-444444444444', 10, 'en_attente');
update transactions set deadline_acceptation = now() - interval '1 hour'
  where id = 'a0d17001-0000-0000-0000-000000000001';

insert into offres (id, createur_id, type, libelle, config, actif) values
  ('a0d17002-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111', 'campagne', 'Audit campagne test',
   jsonb_build_object('description', 'x', 'objectif', 100,
     'date_fin', (current_date - interval '1 day')::date::text),
   true);

insert into transactions (id, fan_id, createur_id, offre_id, montant, statut, necessite_remboursement_manuel) values
  ('a0d17003-0000-0000-0000-000000000003',
   '22222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111',
   '44444444-4444-4444-4444-444444444444', 10, 'remboursee', true);

-- A user nobody has ever granted admin to (22222222 already legitimately
-- became admin earlier in this file via a real set_admin_status() call --
-- reusing it here would make a false "still admin" positive impossible
-- to distinguish from a real attack success).
insert into users (id) values ('a0d17004-0000-0000-0000-000000000004');

select set_config('app.current_user_id', '', false);
set role anon;

do $$
begin
  begin
    perform 1 from process_transaction_deadlines();
    raise exception 'TEST FAILED: anon was able to call process_transaction_deadlines() directly';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no EXECUTE privilege on process_transaction_deadlines() (migration 0021)';
  end;
end $$;

do $$
begin
  begin
    perform 1 from close_expired_campagnes();
    raise exception 'TEST FAILED: anon was able to call close_expired_campagnes() directly';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no EXECUTE privilege on close_expired_campagnes() (migration 0021)';
  end;
end $$;

do $$
begin
  begin
    perform set_admin_status('a0d17004-0000-0000-0000-000000000004', true);
    raise exception 'TEST FAILED: anon was able to call set_admin_status() directly';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no EXECUTE privilege on set_admin_status() (migration 0021)';
  end;
end $$;

do $$
begin
  begin
    perform mark_remboursement_manuel_traite('a0d17003-0000-0000-0000-000000000003');
    raise exception 'TEST FAILED: anon was able to call mark_remboursement_manuel_traite() directly';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no EXECUTE privilege on mark_remboursement_manuel_traite() (migration 0021)';
  end;
end $$;

reset role;

-- None of the four rejected calls above should have left any trace.
do $$
declare
  v_statut1 text;
  v_actif2 boolean;
  v_necessite3 boolean;
  v_est_admin boolean;
begin
  select statut into v_statut1 from transactions where id = 'a0d17001-0000-0000-0000-000000000001';
  select actif into v_actif2 from offres where id = 'a0d17002-0000-0000-0000-000000000002';
  select necessite_remboursement_manuel into v_necessite3
    from transactions where id = 'a0d17003-0000-0000-0000-000000000003';
  select est_admin into v_est_admin from users where id = 'a0d17004-0000-0000-0000-000000000004';

  if v_statut1 != 'en_attente' then
    raise exception 'TEST FAILED: process_transaction_deadlines attack mutated a transaction despite being rejected (statut=%)', v_statut1;
  end if;
  if not v_actif2 then
    raise exception 'TEST FAILED: close_expired_campagnes attack closed a campagne despite being rejected';
  end if;
  if not v_necessite3 then
    raise exception 'TEST FAILED: mark_remboursement_manuel_traite attack cleared the flag despite being rejected';
  end if;
  if v_est_admin then
    raise exception 'TEST FAILED: set_admin_status attack granted admin despite being rejected';
  end if;

  raise notice 'PASS: none of the four rejected anonymous calls left any trace';
end $$;

-- Positive confirmation the grants still work for their real callers --
-- not just that anon is blocked.
do $$
begin
  if not has_function_privilege('service_role', 'process_transaction_deadlines()', 'EXECUTE') then
    raise exception 'TEST FAILED: service_role lost EXECUTE on process_transaction_deadlines()';
  end if;
  if not has_function_privilege('service_role', 'close_expired_campagnes()', 'EXECUTE') then
    raise exception 'TEST FAILED: service_role lost EXECUTE on close_expired_campagnes()';
  end if;
  if not has_function_privilege('authenticated', 'set_admin_status(uuid,boolean)', 'EXECUTE') then
    raise exception 'TEST FAILED: authenticated lost EXECUTE on set_admin_status()';
  end if;
  if not has_function_privilege('authenticated', 'mark_remboursement_manuel_traite(uuid)', 'EXECUTE') then
    raise exception 'TEST FAILED: authenticated lost EXECUTE on mark_remboursement_manuel_traite()';
  end if;

  raise notice 'PASS: the legitimate callers (service_role for the sweeps, authenticated for the admin RPCs) still have EXECUTE';
end $$;

-- handle_new_auth_user(): also never had EXECUTE revoked, but confirmed
-- this is not a real gap -- Postgres itself refuses to invoke a trigger
-- function directly, regardless of any grant.
do $$
begin
  begin
    perform handle_new_auth_user();
    raise exception 'TEST FAILED: handle_new_auth_user() was called directly without error';
  exception when others then
    if sqlerrm !~ 'trigger functions can only be called as triggers' then
      raise exception 'TEST FAILED: unexpected error calling handle_new_auth_user() directly: %', sqlerrm;
    end if;
    raise notice 'PASS: handle_new_auth_user() cannot be invoked directly (Postgres trigger-function restriction, independent of any grant)';
  end;
end $$;

-- ---------------------------------------------------------------------
-- Fan loyalty badge (migration 0022): badges_fidelite_publics exposes
-- exactly {fan_id, createur_id, depuis} -- no montant, no transaction
-- count -- and only for fans who opted in via badge_fidelite_public.
-- Explicitly tests both directions of the privacy toggle (on AND back
-- off), not just the "on" state.
-- ---------------------------------------------------------------------
insert into users (id) values
  ('ba4de001-0001-0001-0001-000000000001'), -- fan A
  ('ba4de002-0002-0002-0002-000000000002'), -- créateur B
  ('ba4de003-0003-0003-0003-000000000003'), -- créateur C, no transactions from A
  ('ba4de004-0004-0004-0004-000000000004'); -- fan D, never opts in

insert into offres (id, createur_id, type) values
  ('ba4de010-0010-0010-0010-000000000010', 'ba4de002-0002-0002-0002-000000000002', 'don');

insert into transactions (id, fan_id, createur_id, offre_id, montant, statut, created_at) values
  ('ba4de020-0020-0020-0020-000000000020',
   'ba4de001-0001-0001-0001-000000000001',
   'ba4de002-0002-0002-0002-000000000002',
   'ba4de010-0010-0010-0010-000000000010', 5, 'livree', now() - interval '10 days'),
  ('ba4de021-0021-0021-0021-000000000021',
   'ba4de001-0001-0001-0001-000000000001',
   'ba4de002-0002-0002-0002-000000000002',
   'ba4de010-0010-0010-0010-000000000010', 5, 'livree', now() - interval '2 days'),
  ('ba4de022-0022-0022-0022-000000000022',
   'ba4de004-0004-0004-0004-000000000004',
   'ba4de002-0002-0002-0002-000000000002',
   'ba4de010-0010-0010-0010-000000000010', 5, 'livree', now());

do $$
begin
  if exists (
    select 1 from badges_fidelite_publics
    where fan_id = 'ba4de001-0001-0001-0001-000000000001'
      and createur_id = 'ba4de002-0002-0002-0002-000000000002'
  ) then
    raise exception 'TEST FAILED: badges_fidelite_publics exposed a badge before the fan opted in';
  end if;
  raise notice 'PASS: badges_fidelite_publics hides a fan''s badge by default (badge_fidelite_public = false)';
end $$;

update users set badge_fidelite_public = true where id = 'ba4de001-0001-0001-0001-000000000001';

do $$
declare
  v_depuis timestamptz;
  v_count integer;
begin
  select depuis into v_depuis from badges_fidelite_publics
    where fan_id = 'ba4de001-0001-0001-0001-000000000001'
      and createur_id = 'ba4de002-0002-0002-0002-000000000002';

  if v_depuis is null then
    raise exception 'TEST FAILED: badges_fidelite_publics still hides the badge after opting in';
  end if;

  -- Must be the EARLIEST of the two livree transactions (~10 days ago),
  -- not the latest (~2 days ago) -- allow a minute of slack for however
  -- long this test run has taken, not days.
  if abs(extract(epoch from (v_depuis - (now() - interval '10 days')))) > 60 then
    raise exception 'TEST FAILED: badges_fidelite_publics depuis is %, expected ~10 days ago (the earliest livree transaction, not the latest)', v_depuis;
  end if;

  select count(*) into v_count from badges_fidelite_publics
    where createur_id = 'ba4de002-0002-0002-0002-000000000002';
  if v_count != 1 then
    raise exception 'TEST FAILED: expected exactly 1 opted-in supporter for créateur B, got %', v_count;
  end if;

  raise notice 'PASS: badges_fidelite_publics shows the badge once opted in, with depuis = the earliest livree transaction, and excludes fan D (never opted in)';
end $$;

do $$
begin
  if exists (
    select 1 from badges_fidelite_publics where createur_id = 'ba4de003-0003-0003-0003-000000000003'
  ) then
    raise exception 'TEST FAILED: badges_fidelite_publics returned a row for a créateur with zero delivered transactions';
  end if;
  raise notice 'PASS: badges_fidelite_publics never fabricates a row for a créateur/fan pair with no delivered transactions';
end $$;

update users set badge_fidelite_public = false where id = 'ba4de001-0001-0001-0001-000000000001';

do $$
begin
  if exists (
    select 1 from badges_fidelite_publics where fan_id = 'ba4de001-0001-0001-0001-000000000001'
  ) then
    raise exception 'TEST FAILED: badges_fidelite_publics still exposed the badge after the fan turned the setting back off';
  end if;
  raise notice 'PASS: turning badge_fidelite_public back off immediately hides the badge again';
end $$;

do $$
declare
  v_columns text;
begin
  select string_agg(column_name, ',' order by column_name) into v_columns
    from information_schema.columns
    where table_schema = 'public' and table_name = 'badges_fidelite_publics';

  if v_columns != 'createur_id,depuis,fan_id' then
    raise exception 'TEST FAILED: badges_fidelite_publics exposes unexpected columns (%), expected exactly createur_id, depuis, fan_id -- never a montant or transaction count', v_columns;
  end if;

  raise notice 'PASS: badges_fidelite_publics exposes exactly fan_id, createur_id, depuis -- no montant, no transaction count (%)', v_columns;
end $$;

-- ---------------------------------------------------------------------
-- Créateur verification (migration 0023): conflict detection compares
-- LIVE, normalized nom_affichage (case/accents/whitespace-insensitive)
-- across different créateurs -- tested with a real scenario, per brief,
-- not just described. Also confirms the badge never appears before an
-- admin actually approves, and that resolving one side of a conflict
-- never auto-touches the other.
-- ---------------------------------------------------------------------
insert into users (id, nom_affichage) values
  ('face1d01-0001-0001-0001-000000000001', 'Sergio Créateur'),
  ('face1d02-0002-0002-0002-000000000002', '  sergio   créateur  '),
  ('face1d03-0003-0003-0003-000000000003', 'Marie Totalement Différente'),
  ('face1d09-0009-0009-0009-000000000009', null);

-- Dedicated admin for this section only -- no auth.uid() context, same
-- bootstrap mechanism as the very first admin (see migration 0015).
update users set est_admin = true where id = 'face1d09-0009-0009-0009-000000000009';

-- Créateur A requests first -- no conflict yet.
select set_config('app.current_user_id', 'face1d01-0001-0001-0001-000000000001', false);
do $$
declare
  v_row record;
begin
  select * into v_row from creer_demande_verification('tiktok', 'https://tiktok.com/@sergioA');
  if v_row.statut != 'en_attente' then
    raise exception 'TEST FAILED: first request for a unique nom_affichage should be en_attente, got %', v_row.statut;
  end if;
  if v_row.code_verification !~ '^FanBoss-[A-Z0-9]{10}$' then
    raise exception 'TEST FAILED: unexpected code_verification format: %', v_row.code_verification;
  end if;
  raise notice 'PASS: first verification request for a unique nom_affichage starts en_attente with a well-formed code';
end $$;
select set_config('app.current_user_id', '', false);

-- Créateur C, a genuinely different display name, also requests -- must
-- not conflict with anyone.
select set_config('app.current_user_id', 'face1d03-0003-0003-0003-000000000003', false);
select creer_demande_verification('youtube', 'https://youtube.com/@marie');
select set_config('app.current_user_id', '', false);

do $$
declare
  v_statut_a text;
  v_statut_c text;
begin
  select statut into v_statut_a from demandes_verification where createur_id = 'face1d01-0001-0001-0001-000000000001';
  select statut into v_statut_c from demandes_verification where createur_id = 'face1d03-0003-0003-0003-000000000003';
  if v_statut_a != 'en_attente' or v_statut_c != 'en_attente' then
    raise exception 'TEST FAILED: two genuinely different nom_affichage values incorrectly conflicted (a=%, c=%)', v_statut_a, v_statut_c;
  end if;
  raise notice 'PASS: two créateurs with genuinely different display names never conflict';
end $$;

-- Créateur B requests with a normalized-equal name (different case,
-- accents, extra whitespace) -- must conflict immediately, AND must
-- flip créateur A's still-pending request to conflit too.
select set_config('app.current_user_id', 'face1d02-0002-0002-0002-000000000002', false);
do $$
declare
  v_row record;
begin
  select * into v_row from creer_demande_verification('instagram', 'https://instagram.com/sergioB');
  if v_row.statut != 'conflit' then
    raise exception 'TEST FAILED: a normalized-equal display name should conflict immediately, got %', v_row.statut;
  end if;
  raise notice 'PASS: a normalized-equal display name (different case/accents/whitespace) is detected as a conflict on insertion';
end $$;
select set_config('app.current_user_id', '', false);

do $$
declare
  v_statut_a text;
  v_statut_c text;
begin
  select statut into v_statut_a from demandes_verification where createur_id = 'face1d01-0001-0001-0001-000000000001';
  select statut into v_statut_c from demandes_verification where createur_id = 'face1d03-0003-0003-0003-000000000003';
  if v_statut_a != 'conflit' then
    raise exception 'TEST FAILED: créateur A''s still-pending request should have flipped to conflit too, got %', v_statut_a;
  end if;
  if v_statut_c != 'en_attente' then
    raise exception 'TEST FAILED: an unrelated créateur''s request was incorrectly touched by another pair''s conflict (got %)', v_statut_c;
  end if;
  raise notice 'PASS: the conflict flips the OTHER matching créateur''s still-pending request too, and never touches an unrelated créateur''s request';
end $$;

-- Badge must never appear before admin approval.
do $$
declare
  v_verifie_a boolean;
  v_verifie_b boolean;
begin
  select createur_verifie into v_verifie_a from users where id = 'face1d01-0001-0001-0001-000000000001';
  select createur_verifie into v_verifie_b from users where id = 'face1d02-0002-0002-0002-000000000002';
  if v_verifie_a or v_verifie_b then
    raise exception 'TEST FAILED: createur_verifie was set before any admin approval';
  end if;
  raise notice 'PASS: createur_verifie stays false for both conflicting créateurs until an admin actually approves one';
end $$;

-- Admin approves créateur A's (conflict) request -- a human, having
-- looked into it, IS the "manual resolution" palier 2 waits for. Must
-- succeed, and must NOT auto-touch créateur B's still-conflicting request.
select set_config('app.current_user_id', 'face1d09-0009-0009-0009-000000000009', false);
select approuver_verification(
  (select id from demandes_verification where createur_id = 'face1d01-0001-0001-0001-000000000001')
);
select set_config('app.current_user_id', '', false);

do $$
declare
  v_verifie_a boolean;
  v_verifie_b boolean;
  v_statut_b text;
begin
  select createur_verifie into v_verifie_a from users where id = 'face1d01-0001-0001-0001-000000000001';
  select createur_verifie into v_verifie_b from users where id = 'face1d02-0002-0002-0002-000000000002';
  select statut into v_statut_b from demandes_verification where createur_id = 'face1d02-0002-0002-0002-000000000002';

  if not v_verifie_a then
    raise exception 'TEST FAILED: approuver_verification did not set createur_verifie for the approved créateur';
  end if;
  if v_verifie_b then
    raise exception 'TEST FAILED: approving créateur A automatically verified créateur B too -- conflicts must never auto-resolve';
  end if;
  if v_statut_b != 'conflit' then
    raise exception 'TEST FAILED: créateur B''s conflicting request should remain conflit, untouched, got %', v_statut_b;
  end if;
  raise notice 'PASS: approving one side of a conflict never auto-verifies or auto-touches the other side';
end $$;

-- Refusing créateur B's conflicting request: allowed, never touches
-- createur_verifie.
select set_config('app.current_user_id', 'face1d09-0009-0009-0009-000000000009', false);
select refuser_verification(
  (select id from demandes_verification where createur_id = 'face1d02-0002-0002-0002-000000000002')
);
select set_config('app.current_user_id', '', false);

do $$
declare
  v_statut_b text;
  v_verifie_b boolean;
begin
  select statut into v_statut_b from demandes_verification where createur_id = 'face1d02-0002-0002-0002-000000000002';
  select createur_verifie into v_verifie_b from users where id = 'face1d02-0002-0002-0002-000000000002';
  if v_statut_b != 'refuse' then
    raise exception 'TEST FAILED: refuser_verification did not mark the request refuse (got %)', v_statut_b;
  end if;
  if v_verifie_b then
    raise exception 'TEST FAILED: refuser_verification incorrectly set createur_verifie';
  end if;
  raise notice 'PASS: refuser_verification marks the request refuse without ever setting createur_verifie';
end $$;

-- Public exposure: profils_publics shows the badge only for the
-- approved créateur, never the refused/conflicting one.
do $$
declare
  v_verifie_publics_a boolean;
  v_verifie_publics_b boolean;
begin
  select createur_verifie into v_verifie_publics_a from profils_publics where id = 'face1d01-0001-0001-0001-000000000001';
  select createur_verifie into v_verifie_publics_b from profils_publics where id = 'face1d02-0002-0002-0002-000000000002';
  if not v_verifie_publics_a then
    raise exception 'TEST FAILED: profils_publics does not expose the approved créateur''s badge';
  end if;
  if v_verifie_publics_b then
    raise exception 'TEST FAILED: profils_publics exposes a badge for the refused/conflicting créateur';
  end if;
  raise notice 'PASS: profils_publics exposes createur_verifie correctly (true only for the approved créateur)';
end $$;

-- Security, same safe pattern as migration 0019/0020/0021 -- anon has no
-- EXECUTE at all on any of the three new functions, and each rejects a
-- NULL auth.uid() (creer_demande_verification) or a non-admin caller
-- (approuver_verification/refuser_verification). Literal, non-existent
-- uuids are used as arguments throughout: each function's own auth
-- check runs before it ever looks up the target row, so a real target
-- id is never needed to prove the rejection.
set role anon;

do $$
begin
  begin
    perform creer_demande_verification('tiktok', 'https://tiktok.com/@attacker');
    raise exception 'TEST FAILED: anon was able to call creer_demande_verification()';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no EXECUTE privilege on creer_demande_verification()';
  end;
end $$;

do $$
begin
  begin
    perform approuver_verification('00000000-0000-0000-0000-000000000000');
    raise exception 'TEST FAILED: anon was able to call approuver_verification()';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no EXECUTE privilege on approuver_verification()';
  end;
end $$;

do $$
begin
  begin
    perform refuser_verification('00000000-0000-0000-0000-000000000000');
    raise exception 'TEST FAILED: anon was able to call refuser_verification()';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no EXECUTE privilege on refuser_verification()';
  end;
end $$;

reset role;

set role authenticated;

select set_config('app.current_user_id', '', false);
do $$
begin
  begin
    perform creer_demande_verification('tiktok', 'https://tiktok.com/@attacker');
    raise exception 'TEST FAILED: creer_demande_verification() succeeded with auth.uid() IS NULL';
  exception when others then
    if sqlerrm != 'not authenticated' then
      raise exception 'TEST FAILED: unexpected error calling creer_demande_verification() with a NULL auth.uid(): %', sqlerrm;
    end if;
    raise notice 'PASS: creer_demande_verification() rejects a call with auth.uid() IS NULL';
  end;
end $$;

-- A genuinely authenticated but non-admin user cannot approve/refuse --
-- rejected before the target row is even looked up, so a fake id is fine.
select set_config('app.current_user_id', 'face1d03-0003-0003-0003-000000000003', false);

do $$
begin
  begin
    perform approuver_verification('00000000-0000-0000-0000-000000000000');
    raise exception 'TEST FAILED: a non-admin authenticated user was able to call approuver_verification()';
  exception when others then
    if sqlerrm != 'not authorized' then
      raise exception 'TEST FAILED: unexpected error: %', sqlerrm;
    end if;
    raise notice 'PASS: approuver_verification rejects a non-admin authenticated caller';
  end;
end $$;

do $$
begin
  begin
    perform refuser_verification('00000000-0000-0000-0000-000000000000');
    raise exception 'TEST FAILED: a non-admin authenticated user was able to call refuser_verification()';
  exception when others then
    if sqlerrm != 'not authorized' then
      raise exception 'TEST FAILED: unexpected error: %', sqlerrm;
    end if;
    raise notice 'PASS: refuser_verification rejects a non-admin authenticated caller';
  end;
end $$;

select set_config('app.current_user_id', '', false);
reset role;

-- ---------------------------------------------------------------------
-- Lot 2a -- fan confirmation state for delivered video/shoutout offers
-- ONLY (migration 0025). Explicit scope check throughout: don/whatsapp/
-- etc. must never have confirmation_fan touched, even once delivered.
-- ---------------------------------------------------------------------

-- deliver_video() must open the 72h confirmation window the moment it
-- delivers a video.
insert into transactions (id, fan_id, createur_id, offre_id, montant, statut) values
  ('c0f10001-0001-0001-0001-000000000001',
   '22222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111',
   '44444444-4444-4444-4444-444444444444', 10, 'validee');

select set_config('app.current_user_id', '11111111-1111-1111-1111-111111111111', false);
select deliver_video('c0f10001-0001-0001-0001-000000000001', 'videos/test1.mp4');
select set_config('app.current_user_id', '', false);

do $$
declare
  v_statut text;
  v_confirmation text;
  v_deadline timestamptz;
begin
  select statut, confirmation_fan, deadline_confirmation
    into v_statut, v_confirmation, v_deadline
    from transactions where id = 'c0f10001-0001-0001-0001-000000000001';

  if v_statut != 'livree' then
    raise exception 'TEST FAILED: deliver_video did not deliver the transaction (statut=%)', v_statut;
  end if;
  if v_confirmation != 'en_attente' then
    raise exception 'TEST FAILED: confirmation_fan was % instead of en_attente right after delivery', v_confirmation;
  end if;
  if v_deadline is null
     or v_deadline < now() + interval '71 hours'
     or v_deadline > now() + interval '73 hours' then
    raise exception 'TEST FAILED: deadline_confirmation was % instead of ~72h from now', v_deadline;
  end if;
  raise notice 'PASS: deliver_video() opens the confirmation window (confirmation_fan=en_attente, deadline_confirmation~=+72h)';
end $$;

-- Manual confirmation by the fan.
select set_config('app.current_user_id', '22222222-2222-2222-2222-222222222222', false);
select confirmer_livraison_fan('c0f10001-0001-0001-0001-000000000001');
select set_config('app.current_user_id', '', false);

do $$
declare
  v_statut text;
  v_confirmation text;
  v_confirme_at timestamptz;
begin
  select statut, confirmation_fan, confirme_at
    into v_statut, v_confirmation, v_confirme_at
    from transactions where id = 'c0f10001-0001-0001-0001-000000000001';

  if v_statut != 'livree' then
    raise exception 'TEST FAILED: confirmer_livraison_fan changed statut to % (should stay livree)', v_statut;
  end if;
  if v_confirmation != 'confirme' then
    raise exception 'TEST FAILED: confirmation_fan was % instead of confirme after confirmer_livraison_fan', v_confirmation;
  end if;
  if v_confirme_at is null then
    raise exception 'TEST FAILED: confirme_at was not set by confirmer_livraison_fan';
  end if;
  raise notice 'PASS: confirmer_livraison_fan() marks confirmation_fan=confirme and stamps confirme_at, without touching statut';
end $$;

-- Confirming again (already confirme, not en_attente anymore) must be
-- rejected -- the eligibility guard, not a silent no-op.
select set_config('app.current_user_id', '22222222-2222-2222-2222-222222222222', false);
do $$
begin
  begin
    perform confirmer_livraison_fan('c0f10001-0001-0001-0001-000000000001');
    raise exception 'TEST FAILED: confirmer_livraison_fan succeeded a second time on an already-confirmed transaction';
  exception when others then
    if sqlerrm != 'transaction is not awaiting fan confirmation' then
      raise exception 'TEST FAILED: unexpected error re-confirming: %', sqlerrm;
    end if;
    raise notice 'PASS: confirmer_livraison_fan() rejects a transaction that is not (or no longer) awaiting confirmation';
  end;
end $$;
select set_config('app.current_user_id', '', false);

-- Disputing (shoutout): freezes the money -- statut stays livree, no
-- refund is attempted, necessite_remboursement_manuel is never set by
-- this path (that flag specifically means "a refund already happened").
insert into transactions (id, fan_id, createur_id, offre_id, montant, statut) values
  ('c0f10002-0002-0002-0002-000000000002',
   '22222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111',
   '77777777-7777-7777-7777-777777777777', 5, 'validee');

select set_config('app.current_user_id', '11111111-1111-1111-1111-111111111111', false);
select deliver_video('c0f10002-0002-0002-0002-000000000002', 'shoutouts/test2.mp4');
select set_config('app.current_user_id', '22222222-2222-2222-2222-222222222222', false);
select contester_livraison_fan('c0f10002-0002-0002-0002-000000000002');
select set_config('app.current_user_id', '', false);

do $$
declare
  v_statut text;
  v_confirmation text;
  v_montant numeric;
  v_necessite boolean;
  v_reference text;
begin
  select statut, confirmation_fan, montant, necessite_remboursement_manuel,
      reference_remboursement_cinetpay
    into v_statut, v_confirmation, v_montant, v_necessite, v_reference
    from transactions where id = 'c0f10002-0002-0002-0002-000000000002';

  if v_statut != 'livree' then
    raise exception 'TEST FAILED: contester_livraison_fan changed statut to % (money must stay frozen, not refunded)', v_statut;
  end if;
  if v_confirmation != 'conteste' then
    raise exception 'TEST FAILED: confirmation_fan was % instead of conteste', v_confirmation;
  end if;
  if v_montant != 5 then
    raise exception 'TEST FAILED: montant was mutated to % by contester_livraison_fan', v_montant;
  end if;
  if v_necessite then
    raise exception 'TEST FAILED: necessite_remboursement_manuel was set true by a dispute -- no refund has happened yet';
  end if;
  if v_reference is not null then
    raise exception 'TEST FAILED: reference_remboursement_cinetpay was set by a dispute -- no refund was ever attempted';
  end if;
  raise notice 'PASS: contester_livraison_fan() freezes the transaction (confirmation_fan=conteste, statut still livree) without attempting any refund';
end $$;

-- Auto-confirmation once the fan stays silent past deadline_confirmation
-- -- and, as the boundary case, a still-open window is left untouched by
-- the same sweep call.
insert into transactions (id, fan_id, createur_id, offre_id, montant, statut) values
  ('c0f10003-0003-0003-0003-000000000003',
   '22222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111',
   '44444444-4444-4444-4444-444444444444', 10, 'validee'),
  ('c0f10004-0004-0004-0004-000000000004',
   '22222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111',
   '44444444-4444-4444-4444-444444444444', 10, 'validee');

select set_config('app.current_user_id', '11111111-1111-1111-1111-111111111111', false);
select deliver_video('c0f10003-0003-0003-0003-000000000003', 'videos/test3.mp4');
select deliver_video('c0f10004-0004-0004-0004-000000000004', 'videos/test4.mp4');
select set_config('app.current_user_id', '', false);

-- Simulate 72h of fan silence for the first transaction only.
update transactions set deadline_confirmation = now() - interval '1 hour'
  where id = 'c0f10003-0003-0003-0003-000000000003';

select * from process_confirmation_deadlines();

do $$
declare
  v_confirmation_expired text;
  v_confirme_at timestamptz;
  v_confirmation_still_open text;
begin
  select confirmation_fan, confirme_at into v_confirmation_expired, v_confirme_at
    from transactions where id = 'c0f10003-0003-0003-0003-000000000003';
  select confirmation_fan into v_confirmation_still_open
    from transactions where id = 'c0f10004-0004-0004-0004-000000000004';

  if v_confirmation_expired != 'confirme' then
    raise exception 'TEST FAILED: process_confirmation_deadlines left confirmation_fan=% for a transaction past its deadline', v_confirmation_expired;
  end if;
  if v_confirme_at is null then
    raise exception 'TEST FAILED: process_confirmation_deadlines did not stamp confirme_at on auto-confirmation';
  end if;
  if v_confirmation_still_open != 'en_attente' then
    raise exception 'TEST FAILED: process_confirmation_deadlines touched a transaction whose deadline has not passed yet (confirmation_fan=%)', v_confirmation_still_open;
  end if;
  raise notice 'PASS: process_confirmation_deadlines() auto-confirms only transactions past deadline_confirmation (fan silence = satisfied by default), leaving a still-open window untouched';
end $$;

-- Scope: whatsapp reaching livree via accept_transaction (acceptance IS
-- delivery for whatsapp) must never have confirmation_fan touched.
insert into transactions (id, fan_id, createur_id, offre_id, montant, statut) values
  ('c0f10005-0005-0005-0005-000000000005',
   '22222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111',
   '33333333-3333-3333-3333-333333333333', 20, 'en_attente');

select set_config('app.current_user_id', '11111111-1111-1111-1111-111111111111', false);
select accept_transaction('c0f10005-0005-0005-0005-000000000005');
select set_config('app.current_user_id', '', false);

do $$
declare
  v_statut text;
  v_confirmation text;
  v_deadline timestamptz;
begin
  select statut, confirmation_fan, deadline_confirmation
    into v_statut, v_confirmation, v_deadline
    from transactions where id = 'c0f10005-0005-0005-0005-000000000005';

  if v_statut != 'livree' then
    raise exception 'TEST FAILED: whatsapp transaction was not delivered by accept_transaction (statut=%)', v_statut;
  end if;
  if v_confirmation != 'non_applicable' then
    raise exception 'TEST FAILED: confirmation_fan was % instead of non_applicable for a delivered whatsapp transaction', v_confirmation;
  end if;
  if v_deadline is not null then
    raise exception 'TEST FAILED: deadline_confirmation was set (%) for a whatsapp transaction -- out of this mechanism''s scope', v_deadline;
  end if;
  raise notice 'PASS: whatsapp (accept_transaction cascading straight to livree) never has confirmation_fan touched -- stays non_applicable';
end $$;

-- A fan cannot confirm/dispute an out-of-scope (non-eligible) delivered
-- transaction either -- the eligibility guard covers whatsapp/don/etc
-- exactly the same way it covers "already confirmed" above.
select set_config('app.current_user_id', '22222222-2222-2222-2222-222222222222', false);
do $$
begin
  begin
    perform confirmer_livraison_fan('c0f10005-0005-0005-0005-000000000005');
    raise exception 'TEST FAILED: confirmer_livraison_fan succeeded on a whatsapp transaction (out of Lot 2a scope)';
  exception when others then
    if sqlerrm != 'transaction is not awaiting fan confirmation' then
      raise exception 'TEST FAILED: unexpected error confirming a whatsapp transaction: %', sqlerrm;
    end if;
    raise notice 'PASS: confirmer_livraison_fan() rejects a whatsapp transaction (confirmation_fan=non_applicable, never en_attente)';
  end;
end $$;
select set_config('app.current_user_id', '', false);

-- Scope: don reaching livree via the webhook's two-step transition
-- (en_attente -> validee -> livree, no acceptation step) must also never
-- touch confirmation_fan.
insert into transactions (id, fan_id, createur_id, offre_id, montant, statut) values
  ('c0f10006-0006-0006-0006-000000000006',
   '22222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 5, 'en_attente');
update transactions set statut = 'validee' where id = 'c0f10006-0006-0006-0006-000000000006';
update transactions set statut = 'livree' where id = 'c0f10006-0006-0006-0006-000000000006';

do $$
declare
  v_confirmation text;
  v_deadline timestamptz;
begin
  select confirmation_fan, deadline_confirmation into v_confirmation, v_deadline
    from transactions where id = 'c0f10006-0006-0006-0006-000000000006';

  if v_confirmation != 'non_applicable' then
    raise exception 'TEST FAILED: confirmation_fan was % instead of non_applicable for a delivered don transaction', v_confirmation;
  end if;
  if v_deadline is not null then
    raise exception 'TEST FAILED: deadline_confirmation was set (%) for a don transaction -- out of this mechanism''s scope', v_deadline;
  end if;
  raise notice 'PASS: don (webhook two-step transition to livree) never has confirmation_fan touched -- stays non_applicable';
end $$;

-- Security: same discipline as migration 0020/0021 for every RPC this
-- feature adds -- anon has no EXECUTE at all (real Postgres permission
-- check, not just app logic), authenticated-but-NULL-auth.uid() is
-- rejected by the function body itself, ownership is enforced (a
-- different fan can't act on someone else's transaction), and none of
-- the rejected attempts leave any trace.
insert into transactions (id, fan_id, createur_id, offre_id, montant, statut, confirmation_fan, deadline_confirmation) values
  ('c0f1a001-a001-a001-a001-00000000a001',
   '22222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111',
   '44444444-4444-4444-4444-444444444444', 10, 'livree', 'en_attente', now() + interval '72 hours');

select set_config('app.current_user_id', '', false);
set role anon;

do $$
begin
  begin
    perform confirmer_livraison_fan('c0f1a001-a001-a001-a001-00000000a001');
    raise exception 'TEST FAILED: anon was able to call confirmer_livraison_fan() at all';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no EXECUTE privilege on confirmer_livraison_fan() (migration 0025)';
  end;
end $$;

do $$
begin
  begin
    perform contester_livraison_fan('c0f1a001-a001-a001-a001-00000000a001');
    raise exception 'TEST FAILED: anon was able to call contester_livraison_fan() at all';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no EXECUTE privilege on contester_livraison_fan() (migration 0025)';
  end;
end $$;

do $$
begin
  begin
    perform 1 from process_confirmation_deadlines();
    raise exception 'TEST FAILED: anon was able to call process_confirmation_deadlines() directly';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no EXECUTE privilege on process_confirmation_deadlines() (migration 0025)';
  end;
end $$;

reset role;
set role authenticated;

do $$
begin
  begin
    perform confirmer_livraison_fan('c0f1a001-a001-a001-a001-00000000a001');
    raise exception 'TEST FAILED: confirmer_livraison_fan() succeeded with auth.uid() IS NULL';
  exception when others then
    if sqlerrm != 'not authenticated' then
      raise exception 'TEST FAILED: unexpected error calling confirmer_livraison_fan() with a NULL auth.uid(): %', sqlerrm;
    end if;
    raise notice 'PASS: confirmer_livraison_fan() rejects a call with auth.uid() IS NULL';
  end;
end $$;

do $$
begin
  begin
    perform contester_livraison_fan('c0f1a001-a001-a001-a001-00000000a001');
    raise exception 'TEST FAILED: contester_livraison_fan() succeeded with auth.uid() IS NULL';
  exception when others then
    if sqlerrm != 'not authenticated' then
      raise exception 'TEST FAILED: unexpected error calling contester_livraison_fan() with a NULL auth.uid(): %', sqlerrm;
    end if;
    raise notice 'PASS: contester_livraison_fan() rejects a call with auth.uid() IS NULL';
  end;
end $$;

reset role;

-- Ownership: a different, real authenticated user (not the fan on this
-- transaction) must also be rejected.
select set_config('app.current_user_id', '11111111-1111-1111-1111-111111111111', false);
do $$
begin
  begin
    perform confirmer_livraison_fan('c0f1a001-a001-a001-a001-00000000a001');
    raise exception 'TEST FAILED: the créateur (not the fan) was able to confirm the delivery';
  exception when others then
    if sqlerrm != 'not authorized' then
      raise exception 'TEST FAILED: unexpected error: %', sqlerrm;
    end if;
    raise notice 'PASS: confirmer_livraison_fan() rejects a caller who is not the transaction''s own fan';
  end;
end $$;
select set_config('app.current_user_id', '', false);

-- None of the rejected attacks above should have left any trace.
do $$
declare
  v_confirmation text;
  v_confirme_at timestamptz;
begin
  select confirmation_fan, confirme_at into v_confirmation, v_confirme_at
    from transactions where id = 'c0f1a001-a001-a001-a001-00000000a001';

  if v_confirmation != 'en_attente' then
    raise exception 'TEST FAILED: rejected calls mutated confirmation_fan to %', v_confirmation;
  end if;
  if v_confirme_at is not null then
    raise exception 'TEST FAILED: rejected calls set confirme_at';
  end if;
  raise notice 'PASS: none of the rejected confirm/contest attempts left any trace';
end $$;

-- Positive confirmation the legitimate callers still have EXECUTE.
do $$
begin
  if not has_function_privilege('authenticated', 'confirmer_livraison_fan(uuid)', 'EXECUTE') then
    raise exception 'TEST FAILED: authenticated lost EXECUTE on confirmer_livraison_fan()';
  end if;
  if not has_function_privilege('authenticated', 'contester_livraison_fan(uuid)', 'EXECUTE') then
    raise exception 'TEST FAILED: authenticated lost EXECUTE on contester_livraison_fan()';
  end if;
  if not has_function_privilege('service_role', 'process_confirmation_deadlines()', 'EXECUTE') then
    raise exception 'TEST FAILED: service_role lost EXECUTE on process_confirmation_deadlines()';
  end if;

  raise notice 'PASS: the legitimate callers (authenticated for confirm/contest, service_role for the sweep) still have EXECUTE';
end $$;

select set_config('app.current_user_id', '', false);
reset role;

-- ---------------------------------------------------------------------
-- Lot 2a-bis -- admin resolution of a litige (migration 0026). Both
-- outcomes, rejection once already resolved, rejection for a non-admin
-- and for a NULL auth.uid(), and that faveur_fan genuinely rides the
-- existing handle_transaction_remboursement() trigger rather than
-- duplicating its effects.
-- ---------------------------------------------------------------------

-- Dedicated admin for this section only -- bootstrapped with no
-- auth.uid() context, same mechanism as every other "dedicated admin for
-- this section" fixture in this file (see the créateur-verification
-- section above).
insert into users (id) values ('b17ec001-0001-0001-0001-000000000001');
update users set est_admin = true where id = 'b17ec001-0001-0001-0001-000000000001';

-- faveur_fan: resolve the shoutout dispute from the Lot 2a section above
-- (c0f10002, still confirmation_fan='conteste' at this point). Chosen
-- deliberately reused rather than creating a fresh one, precisely to
-- prove resoudre_litige finds and resolves an old dispute correctly.
select set_config('app.current_user_id', 'b17ec001-0001-0001-0001-000000000001', false);
select resoudre_litige('c0f10002-0002-0002-0002-000000000002', 'faveur_fan', 'vidéo hors-sujet, remboursé');
select set_config('app.current_user_id', '', false);

do $$
declare
  v_statut text;
  v_confirmation text;
  v_resolution text;
  v_resolu_par uuid;
  v_resolu_at timestamptz;
  v_note text;
  v_statut_paiement text;
  v_necessite boolean;
begin
  select statut, confirmation_fan, litige_resolution, litige_resolu_par, litige_resolu_at, litige_note_admin,
      necessite_remboursement_manuel
    into v_statut, v_confirmation, v_resolution, v_resolu_par, v_resolu_at, v_note, v_necessite
    from transactions where id = 'c0f10002-0002-0002-0002-000000000002';

  if v_statut != 'remboursee' then
    raise exception 'TEST FAILED: resoudre_litige(faveur_fan) left statut=% instead of remboursee', v_statut;
  end if;
  if v_confirmation != 'conteste' then
    raise exception 'TEST FAILED: resoudre_litige(faveur_fan) should not touch confirmation_fan (still expected conteste), got %', v_confirmation;
  end if;
  if v_resolution != 'faveur_fan' then
    raise exception 'TEST FAILED: litige_resolution was % instead of faveur_fan', v_resolution;
  end if;
  if v_resolu_par != 'b17ec001-0001-0001-0001-000000000001' then
    raise exception 'TEST FAILED: litige_resolu_par was % instead of the resolving admin', v_resolu_par;
  end if;
  if v_resolu_at is null then
    raise exception 'TEST FAILED: litige_resolu_at was not stamped';
  end if;
  if v_note != 'vidéo hors-sujet, remboursé' then
    raise exception 'TEST FAILED: litige_note_admin was % instead of the note passed in', v_note;
  end if;
  if not v_necessite then
    raise exception 'TEST FAILED: necessite_remboursement_manuel was not set -- the existing handle_transaction_remboursement() trigger should have fired on the transition into remboursee';
  end if;

  select statut_paiement into v_statut_paiement from paiements
    where transaction_id = 'c0f10002-0002-0002-0002-000000000002';
  if v_statut_paiement != 'rembourse' then
    raise exception 'TEST FAILED: paiements.statut_paiement was % instead of rembourse -- resoudre_litige(faveur_fan) must ride the existing trigger, not duplicate it', v_statut_paiement;
  end if;

  raise notice 'PASS: resoudre_litige(faveur_fan) sets statut=remboursee and stamps the decision, and the existing handle_transaction_remboursement() trigger fires exactly as it would for any other refund (paiements.statut_paiement=rembourse, necessite_remboursement_manuel=true)';
end $$;

-- faveur_createur: a fresh disputed video delivery. Deliberately reuses
-- the existing 'confirme' state (not a new one) -- see CLAUDE.md for why
-- this is a design decision, not an oversight.
insert into transactions (id, fan_id, createur_id, offre_id, montant, statut) values
  ('c0f10007-0007-0007-0007-000000000007',
   '22222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111',
   '44444444-4444-4444-4444-444444444444', 10, 'validee');

select set_config('app.current_user_id', '11111111-1111-1111-1111-111111111111', false);
select deliver_video('c0f10007-0007-0007-0007-000000000007', 'videos/test7.mp4');
select set_config('app.current_user_id', '22222222-2222-2222-2222-222222222222', false);
select contester_livraison_fan('c0f10007-0007-0007-0007-000000000007');
select set_config('app.current_user_id', '', false);

select set_config('app.current_user_id', 'b17ec001-0001-0001-0001-000000000001', false);
select resoudre_litige('c0f10007-0007-0007-0007-000000000007', 'faveur_createur', null);
select set_config('app.current_user_id', '', false);

do $$
declare
  v_statut text;
  v_confirmation text;
  v_confirme_at timestamptz;
  v_resolution text;
  v_note text;
begin
  select statut, confirmation_fan, confirme_at, litige_resolution, litige_note_admin
    into v_statut, v_confirmation, v_confirme_at, v_resolution, v_note
    from transactions where id = 'c0f10007-0007-0007-0007-000000000007';

  if v_statut != 'livree' then
    raise exception 'TEST FAILED: resoudre_litige(faveur_createur) changed statut to % (should stay livree)', v_statut;
  end if;
  if v_confirmation != 'confirme' then
    raise exception 'TEST FAILED: resoudre_litige(faveur_createur) left confirmation_fan=% instead of reusing confirme', v_confirmation;
  end if;
  if v_confirme_at is null then
    raise exception 'TEST FAILED: resoudre_litige(faveur_createur) did not stamp confirme_at -- Lot 2b''s wallet calculation would never see this as withdrawable';
  end if;
  if v_resolution != 'faveur_createur' then
    raise exception 'TEST FAILED: litige_resolution was % instead of faveur_createur', v_resolution;
  end if;
  if v_note is not null then
    raise exception 'TEST FAILED: litige_note_admin was % instead of null (none was passed)', v_note;
  end if;

  raise notice 'PASS: resoudre_litige(faveur_createur) reuses confirmation_fan=confirme and stamps confirme_at, making the transaction withdrawable exactly like a normal fan confirmation, with no new state to special-case';
end $$;

-- Rejection: an already-resolved litige cannot be resolved again.
select set_config('app.current_user_id', 'b17ec001-0001-0001-0001-000000000001', false);
do $$
begin
  begin
    perform resoudre_litige('c0f10002-0002-0002-0002-000000000002', 'faveur_createur', null);
    raise exception 'TEST FAILED: resoudre_litige succeeded a second time on an already-resolved litige';
  exception when others then
    if sqlerrm != 'transaction not found or already resolved' then
      raise exception 'TEST FAILED: unexpected error re-resolving an already-resolved litige: %', sqlerrm;
    end if;
    raise notice 'PASS: resoudre_litige() rejects a transaction that is not (or no longer) an open litige';
  end;
end $$;
select set_config('app.current_user_id', '', false);

-- Rejection: a non-admin authenticated caller cannot resolve a litige.
-- Deliberately uses '11111111' (the créateur on this very dispute) rather
-- than '22222222' -- '22222222' was granted admin earlier in this file
-- (via set_admin_status, in the "Admin role" section above) and never
-- revoked, so it would not actually exercise the non-admin path; '11111111'
-- had its admin status revoked in that same section and stays non-admin
-- from that point on, which also nicely proves even the créateur with a
-- stake in the outcome can't rule in their own favor.
insert into transactions (id, fan_id, createur_id, offre_id, montant, statut) values
  ('c0f10008-0008-0008-0008-000000000008',
   '22222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111',
   '77777777-7777-7777-7777-777777777777', 5, 'validee');
select set_config('app.current_user_id', '11111111-1111-1111-1111-111111111111', false);
select deliver_video('c0f10008-0008-0008-0008-000000000008', 'shoutouts/test8.mp4');
select set_config('app.current_user_id', '22222222-2222-2222-2222-222222222222', false);
select contester_livraison_fan('c0f10008-0008-0008-0008-000000000008');
select set_config('app.current_user_id', '11111111-1111-1111-1111-111111111111', false);

do $$
begin
  begin
    perform resoudre_litige('c0f10008-0008-0008-0008-000000000008', 'faveur_createur', null);
    raise exception 'TEST FAILED: a non-admin authenticated user was able to call resoudre_litige()';
  exception when others then
    if sqlerrm != 'not authorized' then
      raise exception 'TEST FAILED: unexpected error: %', sqlerrm;
    end if;
    raise notice 'PASS: resoudre_litige() rejects a non-admin authenticated caller';
  end;
end $$;
select set_config('app.current_user_id', '', false);

-- Rejection: authenticated role with no auth.uid() at all (NULL) is
-- rejected the same way -- `id = auth.uid()` never matches any row when
-- auth.uid() is NULL, so `not exists(...)` is unconditionally true, same
-- NULL-safe pattern already relied on for mark_remboursement_manuel_traite/
-- set_admin_status (see migration 0021's audit).
set role authenticated;
do $$
begin
  begin
    perform resoudre_litige('c0f10008-0008-0008-0008-000000000008', 'faveur_createur', null);
    raise exception 'TEST FAILED: resoudre_litige() succeeded with auth.uid() IS NULL';
  exception when others then
    if sqlerrm != 'not authorized' then
      raise exception 'TEST FAILED: unexpected error calling resoudre_litige() with a NULL auth.uid(): %', sqlerrm;
    end if;
    raise notice 'PASS: resoudre_litige() rejects a call with auth.uid() IS NULL';
  end;
end $$;
reset role;

-- anon has no EXECUTE at all -- real Postgres permission check, same
-- revoke/grant discipline as every other admin RPC in this project.
set role anon;
do $$
begin
  begin
    perform resoudre_litige('c0f10008-0008-0008-0008-000000000008', 'faveur_createur', null);
    raise exception 'TEST FAILED: anon was able to call resoudre_litige() at all';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no EXECUTE privilege on resoudre_litige() (migration 0026)';
  end;
end $$;
reset role;

-- None of the rejected attempts above should have left any trace on the
-- targeted transaction.
do $$
declare
  v_confirmation text;
  v_resolution text;
begin
  select confirmation_fan, litige_resolution into v_confirmation, v_resolution
    from transactions where id = 'c0f10008-0008-0008-0008-000000000008';

  if v_confirmation != 'conteste' then
    raise exception 'TEST FAILED: a rejected resoudre_litige call mutated confirmation_fan to %', v_confirmation;
  end if;
  if v_resolution is not null then
    raise exception 'TEST FAILED: a rejected resoudre_litige call set litige_resolution to %', v_resolution;
  end if;
  raise notice 'PASS: none of the rejected resoudre_litige attempts left any trace';
end $$;

-- Positive confirmation the legitimate caller still has EXECUTE.
do $$
begin
  if not has_function_privilege('authenticated', 'resoudre_litige(uuid,text,text)', 'EXECUTE') then
    raise exception 'TEST FAILED: authenticated lost EXECUTE on resoudre_litige()';
  end if;
  raise notice 'PASS: authenticated still has EXECUTE on resoudre_litige()';
end $$;

select set_config('app.current_user_id', '', false);
reset role;

-- ---------------------------------------------------------------------
-- Lot 2b -- wallet ledger + withdrawal requests (migration 0027). Fresh
-- créateur/fan fixtures used throughout, so the three bucket sums below
-- can be asserted against exact expected numbers rather than against
-- whatever this file's shared '11111111'/'22222222' fixtures have
-- accumulated by this point.
-- ---------------------------------------------------------------------
insert into users (id) values
  ('ba1a0001-0001-0001-0001-000000000001'), -- créateur C
  ('ba1a0002-0002-0002-0002-000000000002'), -- fan F
  ('ba1a0003-0003-0003-0003-000000000003'); -- créateur C2 (unrelated third party)

insert into offres (id, createur_id, type, prix) values
  ('ba1a0010-0010-0010-0010-000000000010', 'ba1a0001-0001-0001-0001-000000000001', 'video', 100),
  ('ba1a0011-0011-0011-0011-000000000011', 'ba1a0001-0001-0001-0001-000000000001', 'whatsapp', 20);

-- T1: validee but not yet delivered -- paiements.statut_paiement stays
-- 'initie' (create_paiement_on_validation() only fires on the transition
-- INTO validee; handle_transaction_livraison() is what later flips it to
-- 'reussi', and that never happens here). Expected net for a $100
-- transaction under the current 15% HT + TVA formula (migration 0024):
-- commission_ht=15, tva=2.4, net=82.6 -- see CLAUDE.md "Commission rate".
--
-- Inserted as en_attente and then UPDATEd to validee, deliberately NOT
-- inserted directly as 'validee' -- create_paiement_on_validation() is an
-- `after update on transactions` trigger (migration 0002), so it never
-- fires on a plain INSERT; without this two-step, no paiements row would
-- ever be created at all for these fixtures. Mirrors what
-- accept_transaction()'s own first UPDATE does internally.
insert into transactions (id, fan_id, createur_id, offre_id, montant, statut) values
  ('ba1a0100-0100-0100-0100-000000000100',
   'ba1a0002-0002-0002-0002-000000000002',
   'ba1a0001-0001-0001-0001-000000000001',
   'ba1a0010-0010-0010-0010-000000000010', 100, 'en_attente');
update transactions set statut = 'validee' where id = 'ba1a0100-0100-0100-0100-000000000100';

-- T2: delivered, then disputed -- lands in en_litige until resolved.
insert into transactions (id, fan_id, createur_id, offre_id, montant, statut) values
  ('ba1a0101-0101-0101-0101-000000000101',
   'ba1a0002-0002-0002-0002-000000000002',
   'ba1a0001-0001-0001-0001-000000000001',
   'ba1a0010-0010-0010-0010-000000000010', 100, 'en_attente');
update transactions set statut = 'validee' where id = 'ba1a0101-0101-0101-0101-000000000101';
select set_config('app.current_user_id', 'ba1a0001-0001-0001-0001-000000000001', false);
select deliver_video('ba1a0101-0101-0101-0101-000000000101', 'videos/wallet-test-2.mp4');
select set_config('app.current_user_id', 'ba1a0002-0002-0002-0002-000000000002', false);
select contester_livraison_fan('ba1a0101-0101-0101-0101-000000000101');
select set_config('app.current_user_id', '', false);

-- T3: delivered and confirmed -- lands in net_a_retirer via confirmation_fan='confirme'.
insert into transactions (id, fan_id, createur_id, offre_id, montant, statut) values
  ('ba1a0102-0102-0102-0102-000000000102',
   'ba1a0002-0002-0002-0002-000000000002',
   'ba1a0001-0001-0001-0001-000000000001',
   'ba1a0010-0010-0010-0010-000000000010', 100, 'en_attente');
update transactions set statut = 'validee' where id = 'ba1a0102-0102-0102-0102-000000000102';
select set_config('app.current_user_id', 'ba1a0001-0001-0001-0001-000000000001', false);
select deliver_video('ba1a0102-0102-0102-0102-000000000102', 'videos/wallet-test-3.mp4');
select set_config('app.current_user_id', 'ba1a0002-0002-0002-0002-000000000002', false);
select confirmer_livraison_fan('ba1a0102-0102-0102-0102-000000000102');
select set_config('app.current_user_id', '', false);

-- T4: whatsapp -- acceptance cascades straight to livree with
-- confirmation_fan='non_applicable', the *other* value net_a_retirer
-- counts. $20 under the 15% HT + TVA formula: commission_ht=3, tva=0.48,
-- net=16.52.
insert into transactions (id, fan_id, createur_id, offre_id, montant, statut) values
  ('ba1a0103-0103-0103-0103-000000000103',
   'ba1a0002-0002-0002-0002-000000000002',
   'ba1a0001-0001-0001-0001-000000000001',
   'ba1a0011-0011-0011-0011-000000000011', 20, 'en_attente');
select set_config('app.current_user_id', 'ba1a0001-0001-0001-0001-000000000001', false);
select accept_transaction('ba1a0103-0103-0103-0103-000000000103');
select set_config('app.current_user_id', '', false);

-- Solde before any litige resolution or withdrawal request:
-- en_attente_livraison=82.6 (T1), en_litige=82.6 (T2), net_a_retirer=99.12 (T3+T4).
select set_config('app.current_user_id', 'ba1a0001-0001-0001-0001-000000000001', false);
do $$
declare
  v_solde record;
begin
  select * into v_solde from solde_wallet_createur('ba1a0001-0001-0001-0001-000000000001');

  if v_solde.en_attente_livraison != 82.6 then
    raise exception 'TEST FAILED: en_attente_livraison was % instead of 82.6', v_solde.en_attente_livraison;
  end if;
  if v_solde.en_litige != 82.6 then
    raise exception 'TEST FAILED: en_litige was % instead of 82.6', v_solde.en_litige;
  end if;
  if v_solde.net_a_retirer != 99.12 then
    raise exception 'TEST FAILED: net_a_retirer was % instead of 99.12', v_solde.net_a_retirer;
  end if;
  raise notice 'PASS: solde_wallet_createur() computes all three buckets correctly (en_attente_livraison=82.6, en_litige=82.6, net_a_retirer=99.12)';
end $$;
select set_config('app.current_user_id', '', false);

-- A litige resolved faveur_createur must move straight into
-- net_a_retirer with NO special code anywhere in this formula -- it
-- reuses confirmation_fan='confirme', already covered by the exact same
-- `in ('confirme', 'non_applicable')` clause a normal confirmation is.
-- Reuses the dedicated admin bootstrapped earlier in this file for the
-- Lot 2a-bis section ('b17ec001...', still admin, never revoked).
select set_config('app.current_user_id', 'b17ec001-0001-0001-0001-000000000001', false);
select resoudre_litige('ba1a0101-0101-0101-0101-000000000101', 'faveur_createur', null);
select set_config('app.current_user_id', '', false);

select set_config('app.current_user_id', 'ba1a0001-0001-0001-0001-000000000001', false);
do $$
declare
  v_solde record;
begin
  select * into v_solde from solde_wallet_createur('ba1a0001-0001-0001-0001-000000000001');

  if v_solde.en_litige != 0 then
    raise exception 'TEST FAILED: en_litige was % instead of 0 after the litige was resolved faveur_createur', v_solde.en_litige;
  end if;
  if v_solde.net_a_retirer != 181.72 then
    raise exception 'TEST FAILED: net_a_retirer was % instead of 181.72 (99.12 + T2''s 82.6) after the litige was resolved faveur_createur', v_solde.net_a_retirer;
  end if;
  if v_solde.en_attente_livraison != 82.6 then
    raise exception 'TEST FAILED: en_attente_livraison was % instead of 82.6 -- resolving the litige must not touch T1', v_solde.en_attente_livraison;
  end if;
  raise notice 'PASS: a litige resolved faveur_createur is counted in net_a_retirer with no special-case code -- it already satisfies the same confirmation_fan in (confirme, non_applicable) clause a normal confirmation does';
end $$;

-- demander_retrait(): server-side re-validation, never trusting a
-- client-sent amount.
do $$
begin
  begin
    perform demander_retrait(10);
    raise exception 'TEST FAILED: demander_retrait succeeded under the $25 minimum';
  exception when others then
    if sqlerrm != 'le montant minimum de retrait est 25$' then
      raise exception 'TEST FAILED: unexpected error: %', sqlerrm;
    end if;
    raise notice 'PASS: demander_retrait() rejects a montant under the $25 minimum';
  end;
end $$;

-- Simulates a falsified/oversized amount sent directly via RPC (the only
-- kind of "client-controlled amount" that exists here, since
-- demander_retrait always recomputes the real balance itself rather than
-- trusting anything the caller sends).
do $$
begin
  begin
    perform demander_retrait(999999);
    raise exception 'TEST FAILED: demander_retrait succeeded for an amount far beyond the real balance';
  exception when others then
    if sqlerrm != 'le montant demandé dépasse le solde disponible' then
      raise exception 'TEST FAILED: unexpected error: %', sqlerrm;
    end if;
    raise notice 'PASS: demander_retrait() rejects a montant beyond the real (server-recomputed) balance, including a direct RPC call with a falsified amount';
  end;
end $$;

do $$
declare
  v_count integer;
begin
  select count(*) into v_count from demandes_retrait
    where createur_id = 'ba1a0001-0001-0001-0001-000000000001';
  if v_count != 0 then
    raise exception 'TEST FAILED: a rejected demander_retrait call left % row(s) behind', v_count;
  end if;
  raise notice 'PASS: neither rejected demander_retrait attempt left a row behind';
end $$;

-- A legitimate request: $100 out of the real 181.72 balance.
select demander_retrait(100);

do $$
declare
  v_solde record;
begin
  select * into v_solde from solde_wallet_createur('ba1a0001-0001-0001-0001-000000000001');
  if v_solde.net_a_retirer != 81.72 then
    raise exception 'TEST FAILED: net_a_retirer was % instead of 81.72 after a pending $100 withdrawal request', v_solde.net_a_retirer;
  end if;
  raise notice 'PASS: a pending (en_attente) withdrawal request is subtracted from net_a_retirer immediately, before any admin decision';
end $$;
select set_config('app.current_user_id', '', false);

-- Ownership: a different, unrelated créateur can never act on C's request
-- (traiter_retrait requires admin, not just "any authenticated user").
-- Note on scope: demandes_retrait_select_own's RLS policy (the "voit"
-- half of "un créateur ne voit/ni ne traite jamais les demandes d'un
-- autre") is not exercised here via a direct SELECT -- this whole
-- checklist file runs as the postgres superuser, which bypasses RLS
-- entirely regardless of app.current_user_id (RLS only ever restricts
-- non-owner, non-superuser roles with real table grants, which this
-- local stub_auth.sql harness deliberately doesn't replicate for
-- authenticated/anon -- see stub_auth.sql's own comment). No other table
-- policy in this project is verified this way in this file either; the
-- guarantee that actually IS testable here, and the one that matters for
-- preventing real harm, is that only a genuine admin can act on any
-- demande at all -- checked below.
select set_config('app.current_user_id', 'ba1a0003-0003-0003-0003-000000000003', false);
do $$
declare
  v_demande_id uuid;
begin
  select id into v_demande_id from demandes_retrait
    where createur_id = 'ba1a0001-0001-0001-0001-000000000001'
    order by demande_at desc limit 1;

  begin
    perform traiter_retrait(v_demande_id, 'traite', null);
    raise exception 'TEST FAILED: an unrelated, non-admin créateur was able to call traiter_retrait()';
  exception when others then
    if sqlerrm != 'not authorized' then
      raise exception 'TEST FAILED: unexpected error: %', sqlerrm;
    end if;
    raise notice 'PASS: traiter_retrait() rejects a non-admin caller, even one who isn''t the créateur on the request either';
  end;
end $$;
select set_config('app.current_user_id', '', false);

-- Not even the requesting créateur themselves can self-approve their own
-- withdrawal -- traiter_retrait requires est_admin, full stop.
select set_config('app.current_user_id', 'ba1a0001-0001-0001-0001-000000000001', false);
do $$
declare
  v_demande_id uuid;
begin
  select id into v_demande_id from demandes_retrait
    where createur_id = 'ba1a0001-0001-0001-0001-000000000001'
    order by demande_at desc limit 1;

  begin
    perform traiter_retrait(v_demande_id, 'traite', null);
    raise exception 'TEST FAILED: a créateur was able to self-approve their own withdrawal request';
  exception when others then
    if sqlerrm != 'not authorized' then
      raise exception 'TEST FAILED: unexpected error: %', sqlerrm;
    end if;
    raise notice 'PASS: traiter_retrait() rejects the requesting créateur themselves -- only a real admin can process a withdrawal';
  end;
end $$;
select set_config('app.current_user_id', '', false);

-- The admin processes it for real.
do $$
declare
  v_demande_id uuid;
  v_statut text;
  v_traite_par uuid;
  v_traite_at timestamptz;
  v_note text;
begin
  select id into v_demande_id from demandes_retrait
    where createur_id = 'ba1a0001-0001-0001-0001-000000000001'
    order by demande_at desc limit 1;

  perform set_config('app.current_user_id', 'b17ec001-0001-0001-0001-000000000001', true);
  perform traiter_retrait(v_demande_id, 'traite', 'viré par Mobile Money le 27/07');
  perform set_config('app.current_user_id', '', true);

  select statut, traite_par, traite_at, note_admin
    into v_statut, v_traite_par, v_traite_at, v_note
    from demandes_retrait where id = v_demande_id;

  if v_statut != 'traite' then
    raise exception 'TEST FAILED: statut was % instead of traite', v_statut;
  end if;
  if v_traite_par != 'b17ec001-0001-0001-0001-000000000001' then
    raise exception 'TEST FAILED: traite_par was % instead of the admin who processed it', v_traite_par;
  end if;
  if v_traite_at is null then
    raise exception 'TEST FAILED: traite_at was not stamped';
  end if;
  if v_note != 'viré par Mobile Money le 27/07' then
    raise exception 'TEST FAILED: note_admin was % instead of the note passed in', v_note;
  end if;
  raise notice 'PASS: traiter_retrait(traite) marks a withdrawal request handled and stamps who/when/why';
end $$;

-- A 'traite' request still counts against net_a_retirer exactly like a
-- still-pending one does (statut != 'refuse') -- the money has actually
-- left the wallet for good now, not just been provisionally reserved.
select set_config('app.current_user_id', 'ba1a0001-0001-0001-0001-000000000001', false);
do $$
declare
  v_solde record;
begin
  select * into v_solde from solde_wallet_createur('ba1a0001-0001-0001-0001-000000000001');
  if v_solde.net_a_retirer != 81.72 then
    raise exception 'TEST FAILED: net_a_retirer was % instead of 81.72 after the withdrawal was marked traite (should be unchanged from the pending state)', v_solde.net_a_retirer;
  end if;
  raise notice 'PASS: a traite withdrawal request still counts against net_a_retirer, same as when it was pending';
end $$;

-- A second decision on the same request is rejected.
do $$
declare
  v_demande_id uuid;
begin
  select id into v_demande_id from demandes_retrait
    where createur_id = 'ba1a0001-0001-0001-0001-000000000001' and statut = 'traite'
    order by traite_at desc limit 1;

  perform set_config('app.current_user_id', 'b17ec001-0001-0001-0001-000000000001', true);
  begin
    perform traiter_retrait(v_demande_id, 'refuse', null);
    raise exception 'TEST FAILED: traiter_retrait succeeded a second time on an already-handled request';
  exception when others then
    if sqlerrm != 'demande not found or already handled' then
      raise exception 'TEST FAILED: unexpected error: %', sqlerrm;
    end if;
    raise notice 'PASS: traiter_retrait() rejects a request that is not (or no longer) en_attente';
  end;
  perform set_config('app.current_user_id', '', true);
end $$;

-- A second, smaller request that gets REFUSED must not permanently
-- reduce net_a_retirer -- only a non-'refuse' statut counts, per the
-- formula.
select demander_retrait(30);

do $$
declare
  v_solde record;
begin
  select * into v_solde from solde_wallet_createur('ba1a0001-0001-0001-0001-000000000001');
  if v_solde.net_a_retirer != 51.72 then
    raise exception 'TEST FAILED: net_a_retirer was % instead of 51.72 with the second ($30) request still pending', v_solde.net_a_retirer;
  end if;
end $$;
select set_config('app.current_user_id', '', false);

do $$
declare
  v_demande_id uuid;
begin
  select id into v_demande_id from demandes_retrait
    where createur_id = 'ba1a0001-0001-0001-0001-000000000001' and statut = 'en_attente'
    order by demande_at desc limit 1;

  perform set_config('app.current_user_id', 'b17ec001-0001-0001-0001-000000000001', true);
  perform traiter_retrait(v_demande_id, 'refuse', 'preuve de virement manquante');
  perform set_config('app.current_user_id', '', true);
end $$;

select set_config('app.current_user_id', 'ba1a0001-0001-0001-0001-000000000001', false);
do $$
declare
  v_solde record;
begin
  select * into v_solde from solde_wallet_createur('ba1a0001-0001-0001-0001-000000000001');
  if v_solde.net_a_retirer != 81.72 then
    raise exception 'TEST FAILED: net_a_retirer was % instead of 81.72 -- a refused request must stop counting against the balance', v_solde.net_a_retirer;
  end if;
  raise notice 'PASS: a refused withdrawal request no longer counts against net_a_retirer, while a traite one still does (81.72)';
end $$;
select set_config('app.current_user_id', '', false);

-- Security: same discipline as every RPC since migration 0020 -- anon has
-- no EXECUTE at all on any of the three new functions, and
-- authenticated-but-NULL-auth.uid() is rejected by each function's own
-- check. Also: solde_wallet_createur can never be asked for someone
-- else's balance.
select set_config('app.current_user_id', 'ba1a0003-0003-0003-0003-000000000003', false);
do $$
begin
  begin
    perform solde_wallet_createur('ba1a0001-0001-0001-0001-000000000001');
    raise exception 'TEST FAILED: an unrelated authenticated user was able to read another créateur''s wallet balance';
  exception when others then
    if sqlerrm != 'not authorized' then
      raise exception 'TEST FAILED: unexpected error: %', sqlerrm;
    end if;
    raise notice 'PASS: solde_wallet_createur() rejects a caller asking for someone else''s balance';
  end;
end $$;
select set_config('app.current_user_id', '', false);

set role anon;
do $$
begin
  begin
    perform solde_wallet_createur('ba1a0001-0001-0001-0001-000000000001');
    raise exception 'TEST FAILED: anon was able to call solde_wallet_createur() at all';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no EXECUTE privilege on solde_wallet_createur() (migration 0027)';
  end;
end $$;

do $$
begin
  begin
    perform demander_retrait(50);
    raise exception 'TEST FAILED: anon was able to call demander_retrait() at all';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no EXECUTE privilege on demander_retrait() (migration 0027)';
  end;
end $$;

do $$
begin
  begin
    perform traiter_retrait('00000000-0000-0000-0000-000000000000', 'traite', null);
    raise exception 'TEST FAILED: anon was able to call traiter_retrait() at all';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no EXECUTE privilege on traiter_retrait() (migration 0027)';
  end;
end $$;
reset role;

set role authenticated;
do $$
begin
  begin
    perform solde_wallet_createur('ba1a0001-0001-0001-0001-000000000001');
    raise exception 'TEST FAILED: solde_wallet_createur() succeeded with auth.uid() IS NULL';
  exception when others then
    if sqlerrm != 'not authenticated' then
      raise exception 'TEST FAILED: unexpected error calling solde_wallet_createur() with a NULL auth.uid(): %', sqlerrm;
    end if;
    raise notice 'PASS: solde_wallet_createur() rejects a call with auth.uid() IS NULL';
  end;
end $$;

do $$
begin
  begin
    perform demander_retrait(50);
    raise exception 'TEST FAILED: demander_retrait() succeeded with auth.uid() IS NULL';
  exception when others then
    if sqlerrm != 'not authenticated' then
      raise exception 'TEST FAILED: unexpected error calling demander_retrait() with a NULL auth.uid(): %', sqlerrm;
    end if;
    raise notice 'PASS: demander_retrait() rejects a call with auth.uid() IS NULL';
  end;
end $$;

do $$
begin
  begin
    perform traiter_retrait('00000000-0000-0000-0000-000000000000', 'traite', null);
    raise exception 'TEST FAILED: traiter_retrait() succeeded with auth.uid() IS NULL';
  exception when others then
    if sqlerrm != 'not authorized' then
      raise exception 'TEST FAILED: unexpected error calling traiter_retrait() with a NULL auth.uid(): %', sqlerrm;
    end if;
    raise notice 'PASS: traiter_retrait() rejects a call with auth.uid() IS NULL (the same NULL-safe est_admin check as resoudre_litige/mark_remboursement_manuel_traite)';
  end;
end $$;
reset role;

-- Positive confirmation the legitimate caller still has EXECUTE.
do $$
begin
  if not has_function_privilege('authenticated', 'solde_wallet_createur(uuid)', 'EXECUTE') then
    raise exception 'TEST FAILED: authenticated lost EXECUTE on solde_wallet_createur()';
  end if;
  if not has_function_privilege('authenticated', 'demander_retrait(numeric)', 'EXECUTE') then
    raise exception 'TEST FAILED: authenticated lost EXECUTE on demander_retrait()';
  end if;
  if not has_function_privilege('authenticated', 'traiter_retrait(uuid,text,text)', 'EXECUTE') then
    raise exception 'TEST FAILED: authenticated lost EXECUTE on traiter_retrait()';
  end if;
  raise notice 'PASS: authenticated still has EXECUTE on solde_wallet_createur()/demander_retrait()/traiter_retrait()';
end $$;

select set_config('app.current_user_id', '', false);
reset role;

-- Lot 3 -- 'offres' reserved pseudo (new /offres route, migration 0028):
-- same pattern as the 'classement' test above, exercising the
-- reserved-word CHECK constraint directly on a fresh user with no prior
-- pseudo change.
do $$
begin
  begin
    update users set pseudo = 'Offres' where id = 'faceb001-0003-0003-0003-000000000003';
    raise exception 'TEST FAILED: the new "offres" route name was accepted as a pseudo';
  exception when check_violation then
    raise notice 'PASS: "offres" is rejected as a pseudo (reserved-word list kept in sync with the new route)';
  end;
end $$;

do $$
begin
  raise notice 'ALL SQL CHECKLIST TESTS PASSED';
end $$;
