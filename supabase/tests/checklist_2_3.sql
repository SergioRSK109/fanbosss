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
-- profils_recherchables (migration 0036): masque_exploration must only
-- hide a créateur from the default, no-search /explorer grid -- never
-- from an active search (exact pseudo or fuzzy keyword, including social
-- links). '11111111' is still masque_exploration = true from the block
-- above, with active offres and pseudo 'Sergio_1' at this point in the
-- file (not yet touched by the pseudo-cooldown tests further down).
-- ---------------------------------------------------------------------
update users set lien_tiktok = 'https://tiktok.com/@findme12345'
  where id = '11111111-1111-1111-1111-111111111111';

do $$
begin
  -- Search population: same "has an active offre" rule as
  -- profils_explorables, but never filtered by masque_exploration.
  if not exists (
    select 1 from profils_recherchables where id = '11111111-1111-1111-1111-111111111111'
  ) then
    raise exception 'TEST FAILED: masque_exploration=true créateur missing from profils_recherchables (search must still find them)';
  end if;

  -- '22222222' still has zero active offres -- search must not surface a
  -- créateur with nothing to offer either, same invariant as the default grid.
  if exists (
    select 1 from profils_recherchables where id = '22222222-2222-2222-2222-222222222222'
  ) then
    raise exception 'TEST FAILED: créateur with zero active offres appeared in profils_recherchables';
  end if;

  raise notice 'PASS: profils_recherchables includes a masque_exploration=true créateur, still requires an active offre';
end $$;

do $$
begin
  -- Exact pseudo search.
  if not exists (
    select 1 from profils_recherchables where pseudo ilike 'Sergio_1'
  ) then
    raise exception 'TEST FAILED: exact pseudo search did not find the masque_exploration=true créateur via profils_recherchables';
  end if;

  -- Fuzzy keyword search against a social link (lien_tiktok) -- the
  -- field this lot added to the searched-columns set.
  if not exists (
    select 1 from profils_recherchables where lien_tiktok ilike '%findme12345%'
  ) then
    raise exception 'TEST FAILED: fuzzy social-link search did not find the masque_exploration=true créateur via profils_recherchables';
  end if;

  raise notice 'PASS: both exact pseudo search and fuzzy social-link search find a masque_exploration=true créateur via profils_recherchables';
end $$;

do $$
begin
  -- The default, no-search grid must still exclude them -- confirms this
  -- lot only widened active search, never weakened the passive default.
  -- profils_explorables doesn't even expose lien_tiktok (it was never
  -- part of that view's column set), so the pseudo match alone is what
  -- proves the exclusion here.
  if exists (
    select 1 from profils_explorables
    where id = '11111111-1111-1111-1111-111111111111' and pseudo ilike 'Sergio_1'
  ) then
    raise exception 'TEST FAILED: masque_exploration=true créateur still matched via profils_explorables (the default/no-search view)';
  end if;

  raise notice 'PASS: profils_explorables (the default, no-search grid) still excludes a masque_exploration=true créateur';
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

-- Migration 0042: contester_livraison_fan() must stamp conteste_at in the
-- same UPDATE as confirmation_fan='conteste' -- this is the actual SLA
-- clock for the 15-business-day commitment in the CGU (article 6.3), and
-- must never be confused with created_at (the original payment date).
do $$
declare
  v_conteste_at timestamptz;
begin
  select conteste_at into v_conteste_at
    from transactions where id = 'c0f10002-0002-0002-0002-000000000002';

  if v_conteste_at is null then
    raise exception 'TEST FAILED: conteste_at was not set by contester_livraison_fan';
  end if;
  if v_conteste_at < now() - interval '1 minute' or v_conteste_at > now() then
    raise exception 'TEST FAILED: conteste_at (%) was not stamped to the actual moment of contestation', v_conteste_at;
  end if;
  raise notice 'PASS: contester_livraison_fan() stamps conteste_at to the real dispute timestamp (migration 0042)';
end $$;

-- conteste_at must never change after the fact -- resoudre_litige()
-- (migration 0026) only ever touches confirmation_fan/confirme_at
-- (faveur_createur) or statut (faveur_fan); it has no reason to touch
-- conteste_at, and never doing so is what keeps the SLA clock honest
-- (an admin resolving a litige must never quietly reset how overdue it
-- was). Uses its OWN dedicated transaction/admin fixture, deliberately
-- NOT c0f10002 -- the Lot 2a-bis section below reuses that exact
-- transaction for its own resoudre_litige(faveur_fan) test, and
-- resolving it here first would leave it already-resolved by the time
-- that later test runs.
insert into transactions (id, fan_id, createur_id, offre_id, montant, statut) values
  ('c0f10042-0042-0042-0042-000000000042',
   '22222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111',
   '77777777-7777-7777-7777-777777777777', 5, 'validee');

select set_config('app.current_user_id', '11111111-1111-1111-1111-111111111111', false);
select deliver_video('c0f10042-0042-0042-0042-000000000042', 'shoutouts/test-conteste-at.mp4');
select set_config('app.current_user_id', '22222222-2222-2222-2222-222222222222', false);
select contester_livraison_fan('c0f10042-0042-0042-0042-000000000042');
select set_config('app.current_user_id', '', false);

-- Stash conteste_at right after the dispute, before resolution, via
-- set_config/current_setting -- the established technique this file
-- already uses (see Lot 5b's report-id stashing) to carry a value across
-- separate top-level statements.
select set_config(
  'app.test_conteste_at_before',
  (select conteste_at::text from transactions where id = 'c0f10042-0042-0042-0042-000000000042'),
  false
);

-- Dedicated admin for this one check only, same bootstrap mechanism as
-- every other "dedicated admin for this section" fixture in this file.
insert into users (id) values ('c0f1a042-0042-0042-0042-000000000042');
update users set est_admin = true where id = 'c0f1a042-0042-0042-0042-000000000042';

select set_config('app.current_user_id', 'c0f1a042-0042-0042-0042-000000000042', false);
select resoudre_litige('c0f10042-0042-0042-0042-000000000042', 'faveur_createur', null);
select set_config('app.current_user_id', '', false);

do $$
declare
  v_conteste_at_before timestamptz := current_setting('app.test_conteste_at_before')::timestamptz;
  v_conteste_at_after timestamptz;
  v_resolu_at timestamptz;
begin
  select conteste_at, litige_resolu_at into v_conteste_at_after, v_resolu_at
    from transactions where id = 'c0f10042-0042-0042-0042-000000000042';

  if v_resolu_at is null then
    raise exception 'TEST FAILED: resoudre_litige did not actually resolve the fixture litige -- this check would be vacuous';
  end if;
  if v_conteste_at_after is distinct from v_conteste_at_before then
    raise exception 'TEST FAILED: resoudre_litige() changed conteste_at from % to %', v_conteste_at_before, v_conteste_at_after;
  end if;
  raise notice 'PASS: resoudre_litige() never modifies conteste_at (the SLA clock stays honest across resolution)';
end $$;

-- Sort order: the admin worklist (/admin's own query, LitigesManager.tsx)
-- must surface the oldest-DISPUTED litige first, not the oldest
-- transaction -- three fresh litiges, disputed in a deliberately
-- scrambled order and then backdated (the only way to control
-- conteste_at precisely, same "disable/backdate directly" pattern
-- already used elsewhere in this file for the pseudo-cooldown/
-- reservation-expiry tests -- there's no legitimate app path to set an
-- arbitrary past dispute timestamp).
insert into transactions (id, fan_id, createur_id, offre_id, montant, statut) values
  ('c0f1a100-0100-0100-0100-000000000100',
   '22222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111',
   '77777777-7777-7777-7777-777777777777', 5, 'validee'),
  ('c0f1a101-0101-0101-0101-000000000101',
   '22222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111',
   '77777777-7777-7777-7777-777777777777', 5, 'validee'),
  ('c0f1a102-0102-0102-0102-000000000102',
   '22222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111',
   '77777777-7777-7777-7777-777777777777', 5, 'validee');

select set_config('app.current_user_id', '11111111-1111-1111-1111-111111111111', false);
select deliver_video('c0f1a100-0100-0100-0100-000000000100', 'shoutouts/sort-a.mp4');
select deliver_video('c0f1a101-0101-0101-0101-000000000101', 'shoutouts/sort-b.mp4');
select deliver_video('c0f1a102-0102-0102-0102-000000000102', 'shoutouts/sort-c.mp4');
select set_config('app.current_user_id', '22222222-2222-2222-2222-222222222222', false);
select contester_livraison_fan('c0f1a100-0100-0100-0100-000000000100');
select contester_livraison_fan('c0f1a101-0101-0101-0101-000000000101');
select contester_livraison_fan('c0f1a102-0102-0102-0102-000000000102');
select set_config('app.current_user_id', '', false);

-- Disable the trigger the same way the pseudo-cooldown test does, to
-- backdate conteste_at directly -- a normal UPDATE can't otherwise move
-- it into the past. Deliberately scrambled: the SECOND transaction
-- inserted (101) gets the OLDEST dispute date, so an id/insertion-order-
-- based sort would get this wrong while a real conteste_at sort gets it
-- right.
update transactions set conteste_at = now() - interval '5 days'
  where id = 'c0f1a100-0100-0100-0100-000000000100';
update transactions set conteste_at = now() - interval '20 days'
  where id = 'c0f1a101-0101-0101-0101-000000000101';
update transactions set conteste_at = now() - interval '12 days'
  where id = 'c0f1a102-0102-0102-0102-000000000102';

do $$
declare
  v_ids uuid[];
begin
  select array_agg(id order by conteste_at asc nulls last) into v_ids
    from transactions
    where id in (
      'c0f1a100-0100-0100-0100-000000000100',
      'c0f1a101-0101-0101-0101-000000000101',
      'c0f1a102-0102-0102-0102-000000000102'
    );

  if v_ids != array[
    'c0f1a101-0101-0101-0101-000000000101'::uuid,
    'c0f1a102-0102-0102-0102-000000000102'::uuid,
    'c0f1a100-0100-0100-0100-000000000100'::uuid
  ] then
    raise exception 'TEST FAILED: ordering by conteste_at asc did not return the oldest-disputed litige first, got %', v_ids;
  end if;
  raise notice 'PASS: ordering litiges by conteste_at asc (the admin worklist''s own query, migration 0042) surfaces the oldest-disputed litige first, regardless of insertion order';
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

-- ---------------------------------------------------------------------
-- Lot 5a -- publications (créateur posts + FanBoss announcements), with
-- visibility gating (migration 0029). Fixture: créateur A (verified),
-- fan B (a real supporter of A -- a livree transaction), fan C (a
-- stranger to A), admin D (not itself createur_verifie, to prove an
-- admin's own verification status is irrelevant to posting as
-- annonce_fanboss).
-- ---------------------------------------------------------------------
insert into users (id, createur_verifie, est_admin) values
  ('5a000001-0000-0000-0000-000000000001', true, false),
  ('5a000002-0000-0000-0000-000000000002', false, false),
  ('5a000003-0000-0000-0000-000000000003', false, false),
  ('5a000004-0000-0000-0000-000000000004', false, true);

insert into offres (id, createur_id, type, prix) values
  ('5a000010-0000-0000-0000-000000000010', '5a000001-0000-0000-0000-000000000001', 'don', null);

insert into transactions (id, fan_id, createur_id, offre_id, montant, statut) values
  ('5a000011-0000-0000-0000-000000000011',
   '5a000002-0000-0000-0000-000000000002',
   '5a000001-0000-0000-0000-000000000001',
   '5a000010-0000-0000-0000-000000000010', 10, 'livree');

-- soutient_createur() correct for both a real supporter and a stranger.
do $$
begin
  if not soutient_createur('5a000002-0000-0000-0000-000000000002', '5a000001-0000-0000-0000-000000000001') then
    raise exception 'TEST FAILED: soutient_createur() should be true for a real supporter';
  end if;
  if soutient_createur('5a000003-0000-0000-0000-000000000003', '5a000001-0000-0000-0000-000000000001') then
    raise exception 'TEST FAILED: soutient_createur() should be false for a stranger';
  end if;
  raise notice 'PASS: soutient_createur() correct for both a supporter and a stranger';
end $$;

-- Créateur A posts one public and one soutiens-only publication.
select set_config('app.current_user_id', '5a000001-0000-0000-0000-000000000001', false);
set role authenticated;
select publier_message('Post public de A', null, 'public');
select publier_message('Post reserve aux soutiens de A', null, 'soutiens');
reset role;

-- Admin D posts requesting visibilite='soutiens' -- must be forced to
-- type=annonce_fanboss / visibilite=public regardless of what was asked.
select set_config('app.current_user_id', '5a000004-0000-0000-0000-000000000004', false);
set role authenticated;
select publier_message('Annonce FanBoss', null, 'soutiens');
reset role;

do $$
declare
  v_row record;
begin
  select * into v_row from publications where auteur_id = '5a000004-0000-0000-0000-000000000004';
  if v_row.type != 'annonce_fanboss' or v_row.visibilite != 'public' then
    raise exception 'TEST FAILED: admin post got type=%, visibilite=% (expected annonce_fanboss/public)',
      v_row.type, v_row.visibilite;
  end if;
  raise notice 'PASS: admin post auto-assigned type=annonce_fanboss, visibilite forced to public regardless of what was requested';
end $$;

-- The real point of this lot: the teaser is never accompanied by the
-- real content in the DB response itself -- not just hidden client-side.
-- A real supporter (B) sees BOTH of A's posts in full. Note the role
-- switch is a top-level statement, not something done from inside a do
-- block -- SET ROLE cannot be driven via set_config(), only a real
-- top-level SET ROLE changes which role RLS/grants are evaluated
-- against; the do $$ $$ blocks below only ever read/assert, they never
-- try to switch role themselves.
select set_config('app.current_user_id', '5a000002-0000-0000-0000-000000000002', false);
set role authenticated;
do $$
declare
  v_public_ok boolean;
  v_soutiens_ok boolean;
begin
  select contenu is not null and contenu_complet = true into v_public_ok
    from publications_visibles
    where auteur_id = '5a000001-0000-0000-0000-000000000001' and visibilite = 'public';
  select contenu is not null and contenu_complet = true into v_soutiens_ok
    from publications_visibles
    where auteur_id = '5a000001-0000-0000-0000-000000000001' and visibilite = 'soutiens';
  if not v_public_ok or not v_soutiens_ok then
    raise exception 'TEST FAILED: a real supporter should see BOTH posts in full';
  end if;
  raise notice 'PASS: a real supporter (soutient_createur = true) sees both the public and the soutiens-only post in full';
end $$;
reset role;

-- A stranger (C) gets a real teaser for the soutiens-only post:
-- contenu/image_r2_key are actually NULL in the row (never sent, not
-- just hidden), and contenu_complet is a clean `false`, never SQL NULL
-- (three-valued-logic pitfall caught and fixed while building this --
-- see migration 0029's own comment).
select set_config('app.current_user_id', '5a000003-0000-0000-0000-000000000003', false);
set role authenticated;
do $$
declare
  v_contenu text;
  v_image_key text;
  v_complet boolean;
begin
  select contenu, image_r2_key, contenu_complet into v_contenu, v_image_key, v_complet
    from publications_visibles
    where auteur_id = '5a000001-0000-0000-0000-000000000001' and visibilite = 'soutiens';
  if v_contenu is not null or v_image_key is not null then
    raise exception 'TEST FAILED: a stranger should never receive the real contenu/image_r2_key for a soutiens-only post';
  end if;
  if v_complet is distinct from false then
    raise exception 'TEST FAILED: contenu_complet should be a clean false for a stranger, got %', v_complet;
  end if;
  raise notice 'PASS: a stranger gets a real teaser (contenu/image_r2_key NULL, contenu_complet = false), never the real content';
end $$;
reset role;

-- An anonymous visitor gets the same real teaser.
select set_config('app.current_user_id', '', false);
set role anon;
do $$
declare
  v_contenu text;
  v_complet boolean;
begin
  select contenu, contenu_complet into v_contenu, v_complet
    from publications_visibles
    where auteur_id = '5a000001-0000-0000-0000-000000000001' and visibilite = 'soutiens';
  if v_contenu is not null then
    raise exception 'TEST FAILED: an anonymous viewer should never receive the real contenu for a soutiens-only post';
  end if;
  if v_complet is distinct from false then
    raise exception 'TEST FAILED: contenu_complet should be a clean false for an anonymous viewer, got % (three-valued-logic regression?)', v_complet;
  end if;
  raise notice 'PASS: an anonymous (NULL auth.uid()) viewer also gets a real teaser, with a clean false contenu_complet, not SQL NULL';
end $$;
reset role;

-- The créateur themselves always sees their own posts in full, regardless
-- of visibilite.
select set_config('app.current_user_id', '5a000001-0000-0000-0000-000000000001', false);
set role authenticated;
do $$
declare
  v_count int;
begin
  select count(*) into v_count from publications_visibles
    where auteur_id = '5a000001-0000-0000-0000-000000000001' and contenu_complet = true;
  if v_count != 2 then
    raise exception 'TEST FAILED: the auteur should see both of their own posts in full, got % rows', v_count;
  end if;
  raise notice 'PASS: the auteur always sees their own posts in full';
end $$;
reset role;

-- publications_accueil: scoped to currently-verified créateurs + every
-- FanBoss announcement, regardless of the admin's own createur_verifie
-- (false for admin D in this fixture). Queried as `authenticated`, not
-- `anon` -- migration 0033 (security audit fix, see its own test
-- section further down) revokes anon's SELECT on this view entirely,
-- since /home now requires a session. The row count itself doesn't
-- depend on which authenticated viewer is asking (admission is scoped by
-- createur_verifie/type, never by viewer), so this only needed a role
-- swap, not a rewritten assertion.
select set_config('app.current_user_id', '5a000003-0000-0000-0000-000000000003', false);
set role authenticated;
do $$
declare
  v_count int;
begin
  select count(*) into v_count from publications_accueil
    where auteur_id in ('5a000001-0000-0000-0000-000000000001', '5a000004-0000-0000-0000-000000000004');
  if v_count != 3 then
    raise exception 'TEST FAILED: expected 3 rows in publications_accueil (2 from verified créateur A + 1 FanBoss announcement from D), got %', v_count;
  end if;
  raise notice 'PASS: publications_accueil includes a verified créateur''s posts and a FanBoss announcement regardless of the admin''s own createur_verifie';
end $$;
reset role;

-- Rate limit: 10/24h, applied uniformly. A has already posted 2 -- fill
-- to 10, then confirm the 11th is rejected.
select set_config('app.current_user_id', '5a000001-0000-0000-0000-000000000001', false);
set role authenticated;
do $$
declare
  i int;
begin
  for i in 1..8 loop
    perform publier_message('filler ' || i, null, 'public');
  end loop;
end $$;
reset role;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from publications where auteur_id = '5a000001-0000-0000-0000-000000000001';
  if v_count != 10 then
    raise exception 'TEST FAILED: expected exactly 10 publications for A after filling the rate limit, got %', v_count;
  end if;
end $$;

select set_config('app.current_user_id', '5a000001-0000-0000-0000-000000000001', false);
set role authenticated;
do $$
begin
  begin
    perform publier_message('should fail, 11th in 24h', null, 'public');
    raise exception 'TEST FAILED: an 11th publication within 24h was accepted';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then
      raise;
    end if;
    if sqlerrm not like '%rate limit%' then
      raise exception 'TEST FAILED: 11th publication rejected for the wrong reason: %', sqlerrm;
    end if;
    raise notice 'PASS: an 11th publication within 24h is rejected (%)', sqlerrm;
  end;
end $$;
reset role;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from publications where auteur_id = '5a000001-0000-0000-0000-000000000001';
  if v_count != 10 then
    raise exception 'TEST FAILED: the rejected 11th attempt should not have left a row behind, count is now %', v_count;
  end if;
  raise notice 'PASS: the rejected 11th attempt left no row behind';
end $$;

-- A non-verified, non-admin caller cannot post at all.
select set_config('app.current_user_id', '5a000003-0000-0000-0000-000000000003', false);
set role authenticated;
do $$
begin
  begin
    perform publier_message('a stranger should not be able to post', null, 'public');
    raise exception 'TEST FAILED: a non-verified, non-admin user was able to post';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    if sqlerrm not like '%not authorized%' then
      raise exception 'TEST FAILED: rejected for the wrong reason: %', sqlerrm;
    end if;
    raise notice 'PASS: a non-verified, non-admin caller is rejected (%)', sqlerrm;
  end;
end $$;
reset role;

-- anon has no EXECUTE on publier_message() at all (real Postgres
-- permission check, same 0020/0021 pattern as every other write RPC).
select set_config('app.current_user_id', '', false);
set role anon;
do $$
begin
  begin
    perform publier_message('anon should not post', null, 'public');
    raise exception 'TEST FAILED: anon was able to call publier_message() at all';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no EXECUTE privilege on publier_message()';
  end;
end $$;
reset role;

-- authenticated with a NULL auth.uid() is rejected by the function's own
-- check, same pattern as every other write RPC since migration 0020.
select set_config('app.current_user_id', '', false);
set role authenticated;
do $$
begin
  begin
    perform publier_message('null auth.uid() should not post', null, 'public');
    raise exception 'TEST FAILED: authenticated with a NULL auth.uid() was able to post';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    if sqlerrm != 'not authenticated' then
      raise exception 'TEST FAILED: unexpected error for a NULL auth.uid(): %', sqlerrm;
    end if;
    raise notice 'PASS: authenticated with a NULL auth.uid() is rejected';
  end;
end $$;
reset role;

-- Positive + negative EXECUTE grant checks on peut_voir_publication_complete()
-- -- the one deliberate exception in this codebase to "never grant a
-- SECURITY DEFINER function to anon" (see migration 0029's own comment
-- for why: it's a read-path helper embedded in a public view, not a
-- caller-invoked action, and takes no fan-id parameter so there is no
-- way to use it to ask about anyone else's relationship).
do $$
begin
  if not has_function_privilege('anon', 'peut_voir_publication_complete(uuid,text)', 'EXECUTE') then
    raise exception 'TEST FAILED: anon should have EXECUTE on peut_voir_publication_complete() (deliberate exception, see migration 0029)';
  end if;
  if not has_function_privilege('authenticated', 'peut_voir_publication_complete(uuid,text)', 'EXECUTE') then
    raise exception 'TEST FAILED: authenticated lost EXECUTE on peut_voir_publication_complete()';
  end if;
  -- Signature updated to 5 args by migration 0037 (video support adds
  -- p_video_r2_key) -- neither the original 3-arg nor the 0031-era 4-arg
  -- signature this check used to reference exists anymore (each dropped
  -- outright, never kept as a second overload, see each migration's own
  -- comment), so has_function_privilege() must be asked about the real
  -- current signature or it would just report "no such function" (a
  -- silent, always-false-condition no-op in plpgsql's IF, never an
  -- error) instead of meaningfully testing the grant.
  if has_function_privilege('anon', 'publier_message(text,text,text,text,text)', 'EXECUTE') then
    raise exception 'TEST FAILED: anon should NOT have EXECUTE on publier_message()';
  end if;
  if not has_function_privilege('authenticated', 'publier_message(text,text,text,text,text)', 'EXECUTE') then
    raise exception 'TEST FAILED: authenticated lost EXECUTE on publier_message()';
  end if;
  raise notice 'PASS: EXECUTE grants on peut_voir_publication_complete()/publier_message() are exactly as intended';
end $$;

-- 'home' reserved pseudo (new /home route, migration 0029): same pattern
-- as 'classement'/'offres' above, exercising the reserved-word CHECK
-- constraint directly on a fresh user with no prior pseudo change.
do $$
begin
  begin
    update users set pseudo = 'Home' where id = 'faceb001-0003-0003-0003-000000000003';
    raise exception 'TEST FAILED: the new "home" route name was accepted as a pseudo';
  exception when check_violation then
    raise notice 'PASS: "home" is rejected as a pseudo (reserved-word list kept in sync with the new route)';
  end;
end $$;

-- ---------------------------------------------------------------------
-- Lot 5b -- moderation for Lot 5a's publications (migration 0030): a
-- fan/créateur can flag a publication, and an admin can hide it (or
-- reject the flag). Fixture: créateur A (verified), fan B (a real
-- supporter of A -- a livree transaction), fan C (a stranger), admin D.
-- Publications inserted directly with known ids (bypassing
-- publier_message() -- that RPC's own behavior is already covered by
-- the Lot 5a section above; this section only needs known publication
-- ids to exercise the new moderation RPCs against).
--
-- Note: report ids ARE auto-generated (via signaler_publication()), so
-- every lookup of a report's id happens here as the superuser (this
-- session's default role, before any SET ROLE), stashed into a
-- set_config() GUC, and read back via current_setting() from inside the
-- role-switched block that needs it -- reading the raw publications/
-- reports tables directly as authenticated/anon would otherwise hit
-- "permission denied", since this stub_auth.sql harness (unlike a real
-- Supabase project) never grants authenticated/anon any table-level
-- privileges at all, only RLS policies; a real project's authenticated
-- role has the base grant Supabase provisions automatically, with RLS
-- then doing the actual restricting. Confirmed empirically (a throwaway
-- DB run hit exactly this "permission denied for table publications"
-- wall on a first draft of this test) before restructuring around it.
-- ---------------------------------------------------------------------
insert into users (id, createur_verifie, est_admin) values
  ('a1000000-0000-0000-0000-000000000001', true, false),
  ('b1000000-0000-0000-0000-000000000002', false, false),
  ('c1000000-0000-0000-0000-000000000003', false, false),
  ('d1000000-0000-0000-0000-000000000004', false, true);

insert into offres (id, createur_id, type, prix) values
  ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'don', null);

insert into transactions (id, fan_id, createur_id, offre_id, montant, statut) values
  ('f1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000002',
   'a1000000-0000-0000-0000-000000000001',
   'e1000000-0000-0000-0000-000000000001', 10, 'livree');

insert into publications (id, auteur_id, type, contenu, visibilite) values
  ('51000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'createur', 'Post public de A', 'public'),
  ('51000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'createur', 'Post soutiens de A', 'soutiens'),
  ('51000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 'createur', 'Deuxieme post public de A', 'public');

-- signaler_publication: a stranger (C) cannot report the soutiens-only
-- post they can't fully see -- reusing peut_voir_publication_complete()
-- exactly as it already exists for the Lot 5a visibility layer.
select set_config('app.current_user_id', 'c1000000-0000-0000-0000-000000000003', false);
set role authenticated;
do $$
begin
  begin
    perform signaler_publication('51000000-0000-0000-0000-000000000002', 'contenu inapproprie');
    raise exception 'TEST FAILED: a stranger reported a post they cannot fully see';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    if sqlerrm not like '%cannot report%' then
      raise exception 'TEST FAILED: rejected for the wrong reason: %', sqlerrm;
    end if;
    raise notice 'PASS: signaler_publication() rejects reporting a post the viewer cannot fully see (teaser)';
  end;
end $$;
reset role;

do $$
begin
  if exists (select 1 from reports where reporter_id = 'c1000000-0000-0000-0000-000000000003') then
    raise exception 'TEST FAILED: the rejected report attempt left a row behind';
  end if;
  raise notice 'PASS: the rejected report attempt left no row behind';
end $$;

-- The real supporter (B) CAN report the same post (they can see it in full).
select set_config('app.current_user_id', 'b1000000-0000-0000-0000-000000000002', false);
set role authenticated;
do $$
begin
  perform signaler_publication('51000000-0000-0000-0000-000000000002', 'contenu inapproprie');
end $$;
reset role;

do $$
declare
  v_row record;
begin
  select * into v_row from reports
    where reporter_id = 'b1000000-0000-0000-0000-000000000002'
      and reported_user_id = 'a1000000-0000-0000-0000-000000000001';
  if v_row.id is null then
    raise exception 'TEST FAILED: a real supporter''s report was not recorded';
  end if;
  if v_row.type != 'signalement' or v_row.statut != 'en_attente' or v_row.publication_id != '51000000-0000-0000-0000-000000000002' then
    raise exception 'TEST FAILED: report row has wrong shape: type=%, statut=%, publication_id=%',
      v_row.type, v_row.statut, v_row.publication_id;
  end if;
  perform set_config('app.tmp_report_id_b', v_row.id::text, false);
  raise notice 'PASS: a real supporter can report a post they can fully see, recorded correctly (type=signalement, statut=en_attente, publication_id set)';
end $$;

-- masquer_publication: non-admin rejected.
select set_config('app.current_user_id', 'b1000000-0000-0000-0000-000000000002', false);
set role authenticated;
do $$
begin
  begin
    perform masquer_publication('51000000-0000-0000-0000-000000000001', true);
    raise exception 'TEST FAILED: a non-admin was able to call masquer_publication()';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    if sqlerrm != 'not authorized' then
      raise exception 'TEST FAILED: rejected for the wrong reason: %', sqlerrm;
    end if;
    raise notice 'PASS: masquer_publication() rejects a non-admin caller';
  end;
end $$;
reset role;

-- masquer_publication: admin succeeds, and the masked publication
-- disappears from publications_visibles/publications_accueil (even for
-- the auteur themselves, and even though it was public).
select set_config('app.current_user_id', 'd1000000-0000-0000-0000-000000000004', false);
set role authenticated;
do $$
begin
  perform masquer_publication('51000000-0000-0000-0000-000000000001', true);
end $$;
reset role;

select set_config('app.current_user_id', 'a1000000-0000-0000-0000-000000000001', false);
set role authenticated;
do $$
declare
  v_count int;
begin
  select count(*) into v_count from publications_visibles
    where id = '51000000-0000-0000-0000-000000000001';
  if v_count != 0 then
    raise exception 'TEST FAILED: a masked public post is still visible in publications_visibles (even to its own auteur), count=%', v_count;
  end if;
  raise notice 'PASS: a masked publication disappears from publications_visibles entirely, even for its own auteur';
end $$;
reset role;

-- Queried as `authenticated`, not `anon` -- migration 0033 (security
-- audit fix, see its own test section further down) revokes anon's
-- SELECT on this view entirely, since /home now requires a session.
select set_config('app.current_user_id', 'a1000000-0000-0000-0000-000000000001', false);
set role authenticated;
do $$
declare
  v_count int;
begin
  select count(*) into v_count from publications_accueil
    where id = '51000000-0000-0000-0000-000000000001';
  if v_count != 0 then
    raise exception 'TEST FAILED: a masked publication still appears in publications_accueil, count=%', v_count;
  end if;
  raise notice 'PASS: a masked publication disappears from publications_accueil too';
end $$;
reset role;

do $$
declare
  v_masque boolean;
begin
  select masque into v_masque from publications where id = '51000000-0000-0000-0000-000000000001';
  if v_masque is distinct from true then
    raise exception 'TEST FAILED: masque should be true after masquer_publication(), got %', v_masque;
  end if;
  raise notice 'PASS: masquer_publication() actually set masque=true on the target row';
end $$;

-- traiter_signalement_publication: non-admin rejected. (report id looked
-- up as superuser above, into app.tmp_report_id_b.)
select set_config('app.current_user_id', 'b1000000-0000-0000-0000-000000000002', false);
set role authenticated;
do $$
begin
  begin
    perform traiter_signalement_publication(current_setting('app.tmp_report_id_b')::uuid, 'rejeter');
    raise exception 'TEST FAILED: a non-admin was able to call traiter_signalement_publication()';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    if sqlerrm != 'not authorized' then
      raise exception 'TEST FAILED: rejected for the wrong reason: %', sqlerrm;
    end if;
    raise notice 'PASS: traiter_signalement_publication() rejects a non-admin caller';
  end;
end $$;
reset role;

-- traiter_signalement_publication('rejeter'): report becomes rejete,
-- the reported publication (the soutiens-only one) is left untouched.
select set_config('app.current_user_id', 'd1000000-0000-0000-0000-000000000004', false);
set role authenticated;
do $$
begin
  perform traiter_signalement_publication(current_setting('app.tmp_report_id_b')::uuid, 'rejeter');
end $$;
reset role;

do $$
declare
  v_statut text;
  v_masque boolean;
begin
  select statut into v_statut from reports where reporter_id = 'b1000000-0000-0000-0000-000000000002';
  if v_statut != 'rejete' then
    raise exception 'TEST FAILED: report statut should be rejete, got %', v_statut;
  end if;
  select masque into v_masque from publications where id = '51000000-0000-0000-0000-000000000002';
  if v_masque is distinct from false then
    raise exception 'TEST FAILED: rejecting a report should never touch the publication''s masque flag, got %', v_masque;
  end if;
  raise notice 'PASS: rejeter sets the report to rejete and leaves the publication untouched (masque still false)';
end $$;

-- A second decision on an already-handled report is rejected (re-entrancy
-- guard), same "already handled" pattern as every other admin RPC.
select set_config('app.current_user_id', 'd1000000-0000-0000-0000-000000000004', false);
set role authenticated;
do $$
begin
  begin
    perform traiter_signalement_publication(current_setting('app.tmp_report_id_b')::uuid, 'masquer');
    raise exception 'TEST FAILED: a second decision on an already-handled report was accepted';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    if sqlerrm not like '%already handled%' then
      raise exception 'TEST FAILED: rejected for the wrong reason: %', sqlerrm;
    end if;
    raise notice 'PASS: a second decision on an already-handled report is rejected';
  end;
end $$;
reset role;

-- traiter_signalement_publication('masquer'): a fresh report, masks the
-- publication AND marks the report traite.
select set_config('app.current_user_id', 'c1000000-0000-0000-0000-000000000003', false);
set role authenticated;
do $$
begin
  perform signaler_publication('51000000-0000-0000-0000-000000000003', 'spam');
end $$;
reset role;

do $$
declare
  v_report_id uuid;
begin
  select id into v_report_id from reports
    where reporter_id = 'c1000000-0000-0000-0000-000000000003';
  perform set_config('app.tmp_report_id_c', v_report_id::text, false);
end $$;

select set_config('app.current_user_id', 'd1000000-0000-0000-0000-000000000004', false);
set role authenticated;
do $$
begin
  perform traiter_signalement_publication(current_setting('app.tmp_report_id_c')::uuid, 'masquer');
end $$;
reset role;

do $$
declare
  v_statut text;
  v_masque boolean;
begin
  select statut into v_statut from reports where reporter_id = 'c1000000-0000-0000-0000-000000000003';
  select masque into v_masque from publications where id = '51000000-0000-0000-0000-000000000003';
  if v_statut != 'traite' then
    raise exception 'TEST FAILED: report statut should be traite, got %', v_statut;
  end if;
  if v_masque is distinct from true then
    raise exception 'TEST FAILED: masquer should have set masque=true on the reported publication, got %', v_masque;
  end if;
  raise notice 'PASS: masquer both masks the publication and marks the report traite';
end $$;

-- anon has no EXECUTE at all on any of the three new functions.
select set_config('app.current_user_id', '', false);
set role anon;
do $$
begin
  begin
    perform signaler_publication('00000000-0000-0000-0000-000000000000', 'x');
    raise exception 'TEST FAILED: anon could call signaler_publication()';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no EXECUTE on signaler_publication()';
  end;
  begin
    perform masquer_publication('00000000-0000-0000-0000-000000000000', true);
    raise exception 'TEST FAILED: anon could call masquer_publication()';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no EXECUTE on masquer_publication()';
  end;
  begin
    perform traiter_signalement_publication('00000000-0000-0000-0000-000000000000', 'rejeter');
    raise exception 'TEST FAILED: anon could call traiter_signalement_publication()';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no EXECUTE on traiter_signalement_publication()';
  end;
end $$;
reset role;

-- authenticated with a NULL auth.uid() is rejected everywhere.
select set_config('app.current_user_id', '', false);
set role authenticated;
do $$
begin
  begin
    perform signaler_publication('00000000-0000-0000-0000-000000000000', 'x');
    raise exception 'TEST FAILED: authenticated with a NULL auth.uid() could call signaler_publication()';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    if sqlerrm != 'not authenticated' then
      raise exception 'TEST FAILED: unexpected error: %', sqlerrm;
    end if;
    raise notice 'PASS: signaler_publication() rejects a NULL auth.uid()';
  end;
  begin
    perform masquer_publication('00000000-0000-0000-0000-000000000000', true);
    raise exception 'TEST FAILED: authenticated with a NULL auth.uid() could call masquer_publication()';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    if sqlerrm != 'not authorized' then
      raise exception 'TEST FAILED: unexpected error: %', sqlerrm;
    end if;
    raise notice 'PASS: masquer_publication() rejects a NULL auth.uid() (NULL-safe est_admin check)';
  end;
  begin
    perform traiter_signalement_publication('00000000-0000-0000-0000-000000000000', 'rejeter');
    raise exception 'TEST FAILED: authenticated with a NULL auth.uid() could call traiter_signalement_publication()';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    if sqlerrm != 'not authorized' then
      raise exception 'TEST FAILED: unexpected error: %', sqlerrm;
    end if;
    raise notice 'PASS: traiter_signalement_publication() rejects a NULL auth.uid()';
  end;
end $$;
reset role;

-- Positive: authenticated still holds EXECUTE on all three new functions.
do $$
begin
  if not has_function_privilege('authenticated', 'signaler_publication(uuid,text)', 'EXECUTE') then
    raise exception 'TEST FAILED: authenticated lost EXECUTE on signaler_publication()';
  end if;
  if not has_function_privilege('authenticated', 'masquer_publication(uuid,boolean)', 'EXECUTE') then
    raise exception 'TEST FAILED: authenticated lost EXECUTE on masquer_publication()';
  end if;
  if not has_function_privilege('authenticated', 'traiter_signalement_publication(uuid,text)', 'EXECUTE') then
    raise exception 'TEST FAILED: authenticated lost EXECUTE on traiter_signalement_publication()';
  end if;
  raise notice 'PASS: authenticated still holds EXECUTE on all three new functions';
end $$;

-- ---------------------------------------------------------------------
-- Lot 5c -- engagement on publications: likes, reposts, share counts,
-- and per-fan mute (migration 0031). Fixture: créateur A (verified,
-- posts the originals), créateur B (verified, reposts), fan C (a
-- stranger to A -- not verified, not admin), admin D (not itself
-- createur_verifie), fan E (a real supporter of A via a livree
-- transaction, same "soutient_createur" mechanism as Lot 5a).
-- ---------------------------------------------------------------------
insert into users (id, createur_verifie, est_admin) values
  ('5c000001-0000-0000-0000-000000000001', true, false),
  ('5c000002-0000-0000-0000-000000000002', true, false),
  ('5c000003-0000-0000-0000-000000000003', false, false),
  ('5c000004-0000-0000-0000-000000000004', false, true),
  ('5c000005-0000-0000-0000-000000000005', false, false);

insert into offres (id, createur_id, type, prix) values
  ('5c000010-0000-0000-0000-000000000010', '5c000001-0000-0000-0000-000000000001', 'don', null);

insert into transactions (id, fan_id, createur_id, offre_id, montant, statut) values
  ('5c000011-0000-0000-0000-000000000011',
   '5c000005-0000-0000-0000-000000000005',
   '5c000001-0000-0000-0000-000000000001',
   '5c000010-0000-0000-0000-000000000010', 10, 'livree');

-- A posts: P1 (public, repost allowed -- the default), P2 (soutiens-only).
select set_config('app.current_user_id', '5c000001-0000-0000-0000-000000000001', false);
set role authenticated;
select publier_message('5c P1 public repostable', null, 'public', 'tous');
select publier_message('5c P2 soutiens only', null, 'soutiens', 'tous');
reset role;

do $$
declare v_p1 uuid; v_p2 uuid;
begin
  select id into v_p1 from publications where contenu = '5c P1 public repostable';
  select id into v_p2 from publications where contenu = '5c P2 soutiens only';
  perform set_config('app.tmp_p1', v_p1::text, false);
  perform set_config('app.tmp_p2', v_p2::text, false);
end $$;

-- =======================================================================
-- LIKES
-- =======================================================================

-- Toggle: a real supporter (E, can see P2 in full) likes it, then unlikes.
select set_config('app.current_user_id', '5c000005-0000-0000-0000-000000000005', false);
set role authenticated;
do $$
declare v_liked boolean; v_count int;
begin
  select liked, likes_count into v_liked, v_count
    from toggler_like_publication(current_setting('app.tmp_p2')::uuid);
  if v_liked is distinct from true or v_count != 1 then
    raise exception 'TEST FAILED: first like should return liked=true, count=1, got liked=%, count=%', v_liked, v_count;
  end if;

  select liked, likes_count into v_liked, v_count
    from toggler_like_publication(current_setting('app.tmp_p2')::uuid);
  if v_liked is distinct from false or v_count != 0 then
    raise exception 'TEST FAILED: second call (unlike) should return liked=false, count=0, got liked=%, count=%', v_liked, v_count;
  end if;
  raise notice 'PASS: toggler_like_publication() toggles on then off, count follows correctly';
end $$;
reset role;

-- A stranger (C) cannot like the same soutiens-only post -- they can't
-- fully see it (peut_voir_publication_complete() = false).
select set_config('app.current_user_id', '5c000003-0000-0000-0000-000000000003', false);
set role authenticated;
do $$
begin
  begin
    perform toggler_like_publication(current_setting('app.tmp_p2')::uuid);
    raise exception 'TEST FAILED: a stranger liked a post they cannot fully see';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    if sqlerrm not like '%cannot like%' then
      raise exception 'TEST FAILED: rejected for the wrong reason: %', sqlerrm;
    end if;
    raise notice 'PASS: toggler_like_publication() rejects liking a teaser the viewer cannot fully see';
  end;
end $$;
reset role;

do $$
begin
  if exists (select 1 from publications_likes where fan_id = '5c000003-0000-0000-0000-000000000003') then
    raise exception 'TEST FAILED: the rejected like attempt left a row behind';
  end if;
  raise notice 'PASS: the rejected like attempt left no row behind';
end $$;

-- authenticated with a NULL auth.uid() is rejected.
select set_config('app.current_user_id', '', false);
set role authenticated;
do $$
begin
  begin
    perform toggler_like_publication(current_setting('app.tmp_p1')::uuid);
    raise exception 'TEST FAILED: authenticated with a NULL auth.uid() could like a publication';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    if sqlerrm != 'not authenticated' then
      raise exception 'TEST FAILED: unexpected error: %', sqlerrm;
    end if;
    raise notice 'PASS: toggler_like_publication() rejects a NULL auth.uid()';
  end;
end $$;
reset role;

-- =======================================================================
-- REPOSTS -- every rejection condition tested individually.
-- =======================================================================

-- A non-verified, non-admin caller (C) cannot repost at all.
select set_config('app.current_user_id', '5c000003-0000-0000-0000-000000000003', false);
set role authenticated;
do $$
begin
  begin
    perform toggler_repost_publication(current_setting('app.tmp_p1')::uuid);
    raise exception 'TEST FAILED: a non-verified, non-admin user was able to repost';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    if sqlerrm not like '%not authorized%' then
      raise exception 'TEST FAILED: rejected for the wrong reason: %', sqlerrm;
    end if;
    raise notice 'PASS: toggler_repost_publication() rejects a non-verified, non-admin caller';
  end;
end $$;
reset role;

-- Target is soutiens-only: rejected even for an eligible reposter (B).
select set_config('app.current_user_id', '5c000002-0000-0000-0000-000000000002', false);
set role authenticated;
do $$
begin
  begin
    perform toggler_repost_publication(current_setting('app.tmp_p2')::uuid);
    raise exception 'TEST FAILED: a soutiens-only publication was reposted';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    if sqlerrm not like '%non-public%' then
      raise exception 'TEST FAILED: rejected for the wrong reason: %', sqlerrm;
    end if;
    raise notice 'PASS: toggler_repost_publication() rejects a non-public target';
  end;
end $$;
reset role;

-- Target has autorise_repost = 'personne'.
select set_config('app.current_user_id', '5c000001-0000-0000-0000-000000000001', false);
set role authenticated;
select publier_message('5c P3 no repost allowed', null, 'public', 'personne');
reset role;

do $$
declare v_p3 uuid;
begin
  select id into v_p3 from publications where contenu = '5c P3 no repost allowed';
  perform set_config('app.tmp_p3', v_p3::text, false);
end $$;

select set_config('app.current_user_id', '5c000002-0000-0000-0000-000000000002', false);
set role authenticated;
do $$
begin
  begin
    perform toggler_repost_publication(current_setting('app.tmp_p3')::uuid);
    raise exception 'TEST FAILED: a publication with autorise_repost=personne was reposted';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    if sqlerrm not like '%not allowed by the author%' then
      raise exception 'TEST FAILED: rejected for the wrong reason: %', sqlerrm;
    end if;
    raise notice 'PASS: toggler_repost_publication() rejects a target whose author set autorise_repost=personne';
  end;
end $$;
reset role;

-- Target is masked.
select set_config('app.current_user_id', '5c000001-0000-0000-0000-000000000001', false);
set role authenticated;
select publier_message('5c P4 will be masked', null, 'public', 'tous');
reset role;

do $$
declare v_p4 uuid;
begin
  select id into v_p4 from publications where contenu = '5c P4 will be masked';
  perform set_config('app.tmp_p4', v_p4::text, false);
end $$;

select set_config('app.current_user_id', '5c000004-0000-0000-0000-000000000004', false);
set role authenticated;
do $$
begin
  perform masquer_publication(current_setting('app.tmp_p4')::uuid, true);
end $$;
reset role;

select set_config('app.current_user_id', '5c000002-0000-0000-0000-000000000002', false);
set role authenticated;
do $$
begin
  begin
    perform toggler_repost_publication(current_setting('app.tmp_p4')::uuid);
    raise exception 'TEST FAILED: a masked publication was reposted';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    if sqlerrm not like '%hidden%' then
      raise exception 'TEST FAILED: rejected for the wrong reason: %', sqlerrm;
    end if;
    raise notice 'PASS: toggler_repost_publication() rejects a masked target';
  end;
end $$;
reset role;

-- B successfully reposts P1. A second call now toggles it OFF (real
-- delete) and a third toggles it back ON -- this function became a real
-- toggle in migration 0032 (renamed from reposter_publication(), which
-- used to reject a second call outright as "already reposted"; see the
-- dedicated "Follow-up to Lot 5c" section further down for the full
-- toggle-cycle coverage, quota release, and non-repost-row safety). This
-- block only needs to end with B holding exactly one live repost of P1,
-- so the rate-limit fill right after it still adds up to 10.
select set_config('app.current_user_id', '5c000002-0000-0000-0000-000000000002', false);
set role authenticated;
do $$
declare v_id uuid; v_type text; v_reposted boolean;
begin
  select reposted, id, type into v_reposted, v_id, v_type from toggler_repost_publication(current_setting('app.tmp_p1')::uuid);
  if v_reposted is distinct from true or v_id is null or v_type != 'createur' then
    raise exception 'TEST FAILED: toggler_repost_publication() did not insert the expected row (reposted=%, id=%, type=%)', v_reposted, v_id, v_type;
  end if;
  raise notice 'PASS: toggler_repost_publication() succeeds for an eligible caller/target, type auto-assigned to createur';
end $$;

do $$
declare v_id uuid; v_reposted boolean;
begin
  select reposted into v_reposted from toggler_repost_publication(current_setting('app.tmp_p1')::uuid);
  if v_reposted is distinct from false then
    raise exception 'TEST FAILED: a second call on the same target should toggle the repost OFF, got reposted=%', v_reposted;
  end if;

  select reposted, id into v_reposted, v_id from toggler_repost_publication(current_setting('app.tmp_p1')::uuid);
  if v_reposted is distinct from true or v_id is null then
    raise exception 'TEST FAILED: a third call should toggle the repost back ON, got reposted=%, id=%', v_reposted, v_id;
  end if;
  perform set_config('app.tmp_r1', v_id::text, false);
  raise notice 'PASS: toggler_repost_publication() is a real toggle -- a second call un-reposts, a third re-reposts';
end $$;
reset role;

-- Reposting a repost is rejected (A, also eligible, tries to repost B's
-- repost R1).
select set_config('app.current_user_id', '5c000001-0000-0000-0000-000000000001', false);
set role authenticated;
do $$
begin
  begin
    perform toggler_repost_publication(current_setting('app.tmp_r1')::uuid);
    raise exception 'TEST FAILED: a repost of a repost was accepted';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    if sqlerrm not like '%cannot repost a repost%' then
      raise exception 'TEST FAILED: rejected for the wrong reason: %', sqlerrm;
    end if;
    raise notice 'PASS: toggler_repost_publication() rejects reposting a repost';
  end;
end $$;
reset role;

-- Rate limit: shared with publier_message() -- B has already used 1 slot
-- (the R1 repost above). Fill the remaining 9 with plain posts, then
-- confirm the 11th action (a repost of a brand-new target) is rejected.
select set_config('app.current_user_id', '5c000001-0000-0000-0000-000000000001', false);
set role authenticated;
select publier_message('5c P5 rate limit target', null, 'public', 'tous');
reset role;

do $$
declare v_p5 uuid;
begin
  select id into v_p5 from publications where contenu = '5c P5 rate limit target';
  perform set_config('app.tmp_p5', v_p5::text, false);
end $$;

select set_config('app.current_user_id', '5c000002-0000-0000-0000-000000000002', false);
set role authenticated;
do $$
declare i int;
begin
  for i in 1..9 loop
    perform publier_message('5c filler ' || i, null, 'public', 'tous');
  end loop;
end $$;
reset role;

do $$
declare v_count int;
begin
  select count(*) into v_count from publications where auteur_id = '5c000002-0000-0000-0000-000000000002';
  if v_count != 10 then
    raise exception 'TEST FAILED: expected exactly 10 rows (1 repost + 9 posts) for B, got %', v_count;
  end if;
end $$;

select set_config('app.current_user_id', '5c000002-0000-0000-0000-000000000002', false);
set role authenticated;
do $$
begin
  begin
    perform toggler_repost_publication(current_setting('app.tmp_p5')::uuid);
    raise exception 'TEST FAILED: an 11th action (repost) within 24h was accepted, rate limit not shared with publier_message()';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    if sqlerrm not like '%rate limit%' then
      raise exception 'TEST FAILED: rejected for the wrong reason: %', sqlerrm;
    end if;
    raise notice 'PASS: toggler_repost_publication() shares publier_message()''s 10/24h rate limit -- an 11th action (a repost) is rejected';
  end;
end $$;
reset role;

do $$
declare v_count int;
begin
  select count(*) into v_count from publications where auteur_id = '5c000002-0000-0000-0000-000000000002';
  if v_count != 10 then
    raise exception 'TEST FAILED: the rejected 11th attempt should not have left a row behind, count is now %', v_count;
  end if;
  raise notice 'PASS: the rejected 11th attempt (repost) left no row behind';
end $$;

-- =======================================================================
-- CASCADE MASKING -- the most important test in this lot: a repost
-- disappears from BOTH views the instant its referenced ORIGINAL is
-- masked, even though the repost row itself was never touched.
-- =======================================================================

-- A fresh original (P6) + a fresh reposter (D, admin, also eligible) so
-- this doesn't collide with B's now-exhausted rate limit above.
select set_config('app.current_user_id', '5c000001-0000-0000-0000-000000000001', false);
set role authenticated;
select publier_message('5c P6 will cascade', null, 'public', 'tous');
reset role;

do $$
declare v_p6 uuid;
begin
  select id into v_p6 from publications where contenu = '5c P6 will cascade';
  perform set_config('app.tmp_p6', v_p6::text, false);
end $$;

select set_config('app.current_user_id', '5c000004-0000-0000-0000-000000000004', false);
set role authenticated;
do $$
declare v_id uuid;
begin
  select id into v_id from toggler_repost_publication(current_setting('app.tmp_p6')::uuid);
  perform set_config('app.tmp_r2', v_id::text, false);
end $$;
reset role;

-- publications_visibles is checked as `anon` (must stay anon-readable,
-- see migration 0033); publications_accueil is checked as
-- `authenticated` instead -- migration 0033 (security audit fix, see its
-- own test section further down) revokes anon's SELECT on that view
-- entirely, since /home now requires a session. Row presence here
-- doesn't depend on which authenticated viewer is asking.
select set_config('app.current_user_id', '', false);
set role anon;
do $$
declare v_visibles int;
begin
  select count(*) into v_visibles from publications_visibles where id = current_setting('app.tmp_r2')::uuid;
  if v_visibles != 1 then
    raise exception 'TEST FAILED: the repost should be visible in publications_visibles before its original is masked, got % rows', v_visibles;
  end if;
end $$;
reset role;

select set_config('app.current_user_id', '5c000001-0000-0000-0000-000000000001', false);
set role authenticated;
do $$
declare v_accueil int;
begin
  select count(*) into v_accueil from publications_accueil where id = current_setting('app.tmp_r2')::uuid;
  if v_accueil != 1 then
    raise exception 'TEST FAILED: the repost should be visible in publications_accueil before its original is masked, got % rows', v_accueil;
  end if;
end $$;
reset role;

select set_config('app.current_user_id', '5c000004-0000-0000-0000-000000000004', false);
set role authenticated;
do $$
begin
  perform masquer_publication(current_setting('app.tmp_p6')::uuid, true);
end $$;
reset role;

select set_config('app.current_user_id', '', false);
set role anon;
do $$
declare v_visibles int;
begin
  select count(*) into v_visibles from publications_visibles where id = current_setting('app.tmp_r2')::uuid;
  if v_visibles != 0 then
    raise exception 'TEST FAILED: the repost should disappear from publications_visibles once its original is masked, got % rows', v_visibles;
  end if;
end $$;
reset role;

select set_config('app.current_user_id', '5c000001-0000-0000-0000-000000000001', false);
set role authenticated;
do $$
declare v_accueil int;
begin
  select count(*) into v_accueil from publications_accueil where id = current_setting('app.tmp_r2')::uuid;
  if v_accueil != 0 then
    raise exception 'TEST FAILED: the repost should disappear from publications_accueil once its original is masked, got % rows', v_accueil;
  end if;
  raise notice 'PASS: a repost disappears from both views the instant its referenced ORIGINAL is masked';
end $$;
reset role;

do $$
declare v_masque boolean;
begin
  select masque into v_masque from publications where id = current_setting('app.tmp_r2')::uuid;
  if v_masque is distinct from false then
    raise exception 'TEST FAILED: the repost''s OWN masque flag should still be false (it was never touched), got %', v_masque;
  end if;
  raise notice 'PASS: the repost''s own masque flag is untouched -- the cascade comes entirely from the referenced original, not a copied flag';
end $$;

-- =======================================================================
-- PARTAGES -- idempotent (two calls from the same fan = count 1, not 2).
-- =======================================================================

select set_config('app.current_user_id', '5c000005-0000-0000-0000-000000000005', false);
set role authenticated;
do $$
declare v_count int;
begin
  select partages_count into v_count from partager_publication(current_setting('app.tmp_p1')::uuid);
  if v_count != 1 then
    raise exception 'TEST FAILED: first share should bring the count to 1, got %', v_count;
  end if;

  select partages_count into v_count from partager_publication(current_setting('app.tmp_p1')::uuid);
  if v_count != 1 then
    raise exception 'TEST FAILED: a second share by the SAME fan should not double-count, got %', v_count;
  end if;
  raise notice 'PASS: partager_publication() is idempotent -- two calls from the same fan leave the count at 1, not 2';
end $$;
reset role;

do $$
declare v_row_count int;
begin
  select count(*) into v_row_count from publications_partages
    where publication_id = current_setting('app.tmp_p1')::uuid
      and fan_id = '5c000005-0000-0000-0000-000000000005';
  if v_row_count != 1 then
    raise exception 'TEST FAILED: expected exactly one publications_partages row, got %', v_row_count;
  end if;
  raise notice 'PASS: exactly one publications_partages row exists after two share calls from the same fan';
end $$;

-- =======================================================================
-- MUTE -- filters publications_accueil only, never publications_visibles
-- (a muted créateur's own profile page still shows their posts). Also:
-- self-mute rejected, and the toggle actually reverses.
-- =======================================================================

select set_config('app.current_user_id', '5c000001-0000-0000-0000-000000000001', false);
set role authenticated;
do $$
begin
  begin
    perform toggler_mute_createur('5c000001-0000-0000-0000-000000000001');
    raise exception 'TEST FAILED: a self-mute attempt was accepted';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    if sqlerrm not like '%cannot mute yourself%' then
      raise exception 'TEST FAILED: rejected for the wrong reason: %', sqlerrm;
    end if;
    raise notice 'PASS: toggler_mute_createur() rejects a self-mute attempt';
  end;
end $$;
reset role;

select set_config('app.current_user_id', '5c000003-0000-0000-0000-000000000003', false);
set role authenticated;
do $$
declare v_before_accueil int; v_before_visibles int;
begin
  select count(*) into v_before_accueil from publications_accueil where auteur_id = '5c000001-0000-0000-0000-000000000001';
  select count(*) into v_before_visibles from publications_visibles where auteur_id = '5c000001-0000-0000-0000-000000000001';
  if v_before_accueil = 0 or v_before_visibles = 0 then
    raise exception 'TEST FAILED: précondition -- C should see A''s posts in both views before muting (accueil=%, visibles=%)', v_before_accueil, v_before_visibles;
  end if;
end $$;

select toggler_mute_createur('5c000001-0000-0000-0000-000000000001');

do $$
declare v_accueil int; v_visibles int;
begin
  select count(*) into v_accueil from publications_accueil where auteur_id = '5c000001-0000-0000-0000-000000000001';
  select count(*) into v_visibles from publications_visibles where auteur_id = '5c000001-0000-0000-0000-000000000001';
  if v_accueil != 0 then
    raise exception 'TEST FAILED: a muted créateur''s posts should be excluded from publications_accueil, got % rows', v_accueil;
  end if;
  if v_visibles = 0 then
    raise exception 'TEST FAILED: a muted créateur''s own profile page (publications_visibles) should be UNAFFECTED by the mute, got 0 rows';
  end if;
  raise notice 'PASS: mute is asymmetric as designed -- excluded from publications_accueil, completely unaffected in publications_visibles';
end $$;

-- Toggling again un-mutes: A's posts reappear in publications_accueil.
select toggler_mute_createur('5c000001-0000-0000-0000-000000000001');

do $$
declare v_accueil int;
begin
  select count(*) into v_accueil from publications_accueil where auteur_id = '5c000001-0000-0000-0000-000000000001';
  if v_accueil = 0 then
    raise exception 'TEST FAILED: a second toggler_mute_createur() call should un-mute, but A''s posts are still excluded from publications_accueil';
  end if;
  raise notice 'PASS: toggler_mute_createur() is a real toggle -- a second call un-mutes, A''s posts reappear in publications_accueil';
end $$;
reset role;

-- =======================================================================
-- GRANTS AUDIT -- same 0020/0021 pattern for all 4 new functions: anon
-- has no EXECUTE at all, authenticated with a NULL auth.uid() is
-- rejected by each function's own check, and authenticated still holds
-- EXECUTE positively.
-- =======================================================================

select set_config('app.current_user_id', '', false);
set role anon;
do $$
begin
  begin
    perform toggler_like_publication('00000000-0000-0000-0000-000000000000');
    raise exception 'TEST FAILED: anon could call toggler_like_publication()';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no EXECUTE on toggler_like_publication()';
  end;
  begin
    perform toggler_repost_publication('00000000-0000-0000-0000-000000000000');
    raise exception 'TEST FAILED: anon could call toggler_repost_publication()';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no EXECUTE on toggler_repost_publication()';
  end;
  begin
    perform partager_publication('00000000-0000-0000-0000-000000000000');
    raise exception 'TEST FAILED: anon could call partager_publication()';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no EXECUTE on partager_publication()';
  end;
  begin
    perform toggler_mute_createur('00000000-0000-0000-0000-000000000000');
    raise exception 'TEST FAILED: anon could call toggler_mute_createur()';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no EXECUTE on toggler_mute_createur()';
  end;
end $$;
reset role;

select set_config('app.current_user_id', '', false);
set role authenticated;
do $$
begin
  begin
    perform toggler_like_publication('00000000-0000-0000-0000-000000000000');
    raise exception 'TEST FAILED: authenticated with a NULL auth.uid() could call toggler_like_publication()';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    if sqlerrm != 'not authenticated' then
      raise exception 'TEST FAILED: unexpected error: %', sqlerrm;
    end if;
    raise notice 'PASS: toggler_like_publication() rejects a NULL auth.uid()';
  end;
  begin
    perform toggler_repost_publication('00000000-0000-0000-0000-000000000000');
    raise exception 'TEST FAILED: authenticated with a NULL auth.uid() could call toggler_repost_publication()';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    if sqlerrm != 'not authenticated' then
      raise exception 'TEST FAILED: unexpected error: %', sqlerrm;
    end if;
    raise notice 'PASS: toggler_repost_publication() rejects a NULL auth.uid()';
  end;
  begin
    perform partager_publication('00000000-0000-0000-0000-000000000000');
    raise exception 'TEST FAILED: authenticated with a NULL auth.uid() could call partager_publication()';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    if sqlerrm != 'not authenticated' then
      raise exception 'TEST FAILED: unexpected error: %', sqlerrm;
    end if;
    raise notice 'PASS: partager_publication() rejects a NULL auth.uid()';
  end;
  begin
    perform toggler_mute_createur('00000000-0000-0000-0000-000000000000');
    raise exception 'TEST FAILED: authenticated with a NULL auth.uid() could call toggler_mute_createur()';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    if sqlerrm != 'not authenticated' then
      raise exception 'TEST FAILED: unexpected error: %', sqlerrm;
    end if;
    raise notice 'PASS: toggler_mute_createur() rejects a NULL auth.uid()';
  end;
end $$;
reset role;

do $$
begin
  if not has_function_privilege('authenticated', 'toggler_like_publication(uuid)', 'EXECUTE') then
    raise exception 'TEST FAILED: authenticated lost EXECUTE on toggler_like_publication()';
  end if;
  if not has_function_privilege('authenticated', 'toggler_repost_publication(uuid)', 'EXECUTE') then
    raise exception 'TEST FAILED: authenticated lost EXECUTE on toggler_repost_publication()';
  end if;
  if not has_function_privilege('authenticated', 'partager_publication(uuid)', 'EXECUTE') then
    raise exception 'TEST FAILED: authenticated lost EXECUTE on partager_publication()';
  end if;
  if not has_function_privilege('authenticated', 'toggler_mute_createur(uuid)', 'EXECUTE') then
    raise exception 'TEST FAILED: authenticated lost EXECUTE on toggler_mute_createur()';
  end if;
  -- Signature updated again to 5 args by migration 0037 (see the earlier
  -- comment on this same rename pattern, above) -- checked against the
  -- real current signature, not the 4-arg one this block originally
  -- referenced.
  if not has_function_privilege('authenticated', 'publier_message(text,text,text,text,text)', 'EXECUTE') then
    raise exception 'TEST FAILED: authenticated lost EXECUTE on the updated 5-arg publier_message()';
  end if;
  if has_function_privilege('anon', 'publier_message(text,text,text,text,text)', 'EXECUTE') then
    raise exception 'TEST FAILED: anon should NOT have EXECUTE on publier_message()';
  end if;
  raise notice 'PASS: authenticated holds EXECUTE on all 4 new functions and the updated publier_message(); anon holds none';
end $$;

-- ---------------------------------------------------------------------
-- Follow-up to Lot 5c -- créateur self-masking, an authorship-aware
-- menu (UI-only, verified visually not here), and the repost toggle
-- (migration 0032). Fixture: créateur A (verified), créateur B
-- (verified), fan C (a stranger -- not verified, not admin), admin D.
-- ---------------------------------------------------------------------
insert into users (id, createur_verifie, est_admin) values
  ('00320001-0000-0000-0000-000000000001', true, false),
  ('00320002-0000-0000-0000-000000000002', true, false),
  ('00320003-0000-0000-0000-000000000003', false, false),
  ('00320004-0000-0000-0000-000000000004', false, true);

-- A posts P1 (public, repostable).
select set_config('app.current_user_id', '00320001-0000-0000-0000-000000000001', false);
set role authenticated;
select publier_message('0032 P1 public repostable', null, 'public', 'tous');
reset role;

do $$
declare v_id uuid;
begin
  select id into v_id from publications where contenu = '0032 P1 public repostable';
  perform set_config('app.tmp_p1', v_id::text, false);
end $$;

-- =======================================================================
-- masquer_ma_publication() -- self-only, one-way.
-- =======================================================================

-- Non-owner (B) cannot mask A's post.
select set_config('app.current_user_id', '00320002-0000-0000-0000-000000000002', false);
set role authenticated;
do $$
begin
  begin
    perform masquer_ma_publication(current_setting('app.tmp_p1')::uuid);
    raise exception 'TEST FAILED: a non-owner masked someone else''s publication';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    if sqlerrm not like '%only hide your own%' then
      raise exception 'TEST FAILED: rejected for the wrong reason: %', sqlerrm;
    end if;
    raise notice 'PASS: masquer_ma_publication() rejects a non-owner';
  end;
end $$;
reset role;

do $$
declare v_masque boolean;
begin
  select masque into v_masque from publications where id = current_setting('app.tmp_p1')::uuid;
  if v_masque is distinct from false then
    raise exception 'TEST FAILED: the rejected attempt should not have touched masque, got %', v_masque;
  end if;
  raise notice 'PASS: the rejected non-owner attempt left masque untouched';
end $$;

-- Owner (A) can mask their own post.
select set_config('app.current_user_id', '00320001-0000-0000-0000-000000000001', false);
set role authenticated;
select masquer_ma_publication(current_setting('app.tmp_p1')::uuid);
reset role;

do $$
declare v_masque boolean;
begin
  select masque into v_masque from publications where id = current_setting('app.tmp_p1')::uuid;
  if v_masque is distinct from true then
    raise exception 'TEST FAILED: masquer_ma_publication() should have set masque=true, got %', v_masque;
  end if;
  raise notice 'PASS: the owner can mask their own publication';
end $$;

-- It disappears from the public views like any masked publication.
select set_config('app.current_user_id', '', false);
set role anon;
do $$
declare v_count int;
begin
  select count(*) into v_count from publications_visibles where id = current_setting('app.tmp_p1')::uuid;
  if v_count != 0 then
    raise exception 'TEST FAILED: a self-masked publication should disappear from publications_visibles, got % rows', v_count;
  end if;
  raise notice 'PASS: a self-masked publication disappears from publications_visibles';
end $$;
reset role;

-- No way to unmask: there is no boolean parameter at all, so calling it
-- again on an already-masked post is a no-op success (masque stays
-- true) -- the only reversal path is the admin-only masquer_publication().
select set_config('app.current_user_id', '00320001-0000-0000-0000-000000000001', false);
set role authenticated;
select masquer_ma_publication(current_setting('app.tmp_p1')::uuid);
reset role;

do $$
declare v_masque boolean;
begin
  select masque into v_masque from publications where id = current_setting('app.tmp_p1')::uuid;
  if v_masque is distinct from true then
    raise exception 'TEST FAILED: a publication masked via masquer_ma_publication() should stay masked forever (no unmask param exists), got %', v_masque;
  end if;
  raise notice 'PASS: masquer_ma_publication() is one-way -- a créateur can never unmask their own publication through it';
end $$;

-- Grants: anon none, NULL auth.uid() rejected, authenticated holds EXECUTE.
select set_config('app.current_user_id', '', false);
set role anon;
do $$
begin
  begin
    perform masquer_ma_publication('00000000-0000-0000-0000-000000000000');
    raise exception 'TEST FAILED: anon could call masquer_ma_publication()';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no EXECUTE on masquer_ma_publication()';
  end;
end $$;
reset role;

select set_config('app.current_user_id', '', false);
set role authenticated;
do $$
begin
  begin
    perform masquer_ma_publication('00000000-0000-0000-0000-000000000000');
    raise exception 'TEST FAILED: authenticated with a NULL auth.uid() could call masquer_ma_publication()';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    if sqlerrm != 'not authenticated' then
      raise exception 'TEST FAILED: unexpected error: %', sqlerrm;
    end if;
    raise notice 'PASS: masquer_ma_publication() rejects a NULL auth.uid()';
  end;
end $$;
reset role;

do $$
begin
  if not has_function_privilege('authenticated', 'masquer_ma_publication(uuid)', 'EXECUTE') then
    raise exception 'TEST FAILED: authenticated lost EXECUTE on masquer_ma_publication()';
  end if;
  raise notice 'PASS: authenticated holds EXECUTE on masquer_ma_publication()';
end $$;

-- =======================================================================
-- toggler_repost_publication() -- a real toggle now, renamed from
-- reposter_publication().
-- =======================================================================

-- The old name is truly gone, not kept as an overload/alias.
do $$
begin
  begin
    perform reposter_publication('00000000-0000-0000-0000-000000000000');
    raise exception 'TEST FAILED: reposter_publication() still exists and is callable';
  exception when undefined_function then
    raise notice 'PASS: reposter_publication() no longer exists (renamed, not aliased)';
  end;
end $$;

-- A fresh target from A for the toggle tests.
select set_config('app.current_user_id', '00320001-0000-0000-0000-000000000001', false);
set role authenticated;
select publier_message('0032 P2 toggle target', null, 'public', 'tous');
reset role;

do $$
declare v_id uuid;
begin
  select id into v_id from publications where contenu = '0032 P2 toggle target';
  perform set_config('app.tmp_p2', v_id::text, false);
end $$;

-- Every rejection condition on the FIRST repost still applies,
-- individually.
select set_config('app.current_user_id', '00320003-0000-0000-0000-000000000003', false);
set role authenticated;
do $$
begin
  begin
    perform toggler_repost_publication(current_setting('app.tmp_p2')::uuid);
    raise exception 'TEST FAILED: a non-verified, non-admin caller reposted';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    if sqlerrm not like '%not authorized%' then
      raise exception 'TEST FAILED: rejected for the wrong reason: %', sqlerrm;
    end if;
    raise notice 'PASS: toggler_repost_publication() rejects a non-verified, non-admin caller';
  end;
end $$;
reset role;

select set_config('app.current_user_id', '00320001-0000-0000-0000-000000000001', false);
set role authenticated;
select publier_message('0032 P3 soutiens only', null, 'soutiens', 'tous');
select publier_message('0032 P4 no repost allowed', null, 'public', 'personne');
reset role;

do $$
declare v_p3 uuid; v_p4 uuid;
begin
  select id into v_p3 from publications where contenu = '0032 P3 soutiens only';
  select id into v_p4 from publications where contenu = '0032 P4 no repost allowed';
  perform set_config('app.tmp_p3', v_p3::text, false);
  perform set_config('app.tmp_p4', v_p4::text, false);
end $$;

select set_config('app.current_user_id', '00320002-0000-0000-0000-000000000002', false);
set role authenticated;
do $$
begin
  begin
    perform toggler_repost_publication(current_setting('app.tmp_p3')::uuid);
    raise exception 'TEST FAILED: a soutiens-only publication was reposted';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    if sqlerrm not like '%non-public%' then
      raise exception 'TEST FAILED: rejected for the wrong reason: %', sqlerrm;
    end if;
    raise notice 'PASS: toggler_repost_publication() (first repost) rejects a non-public target';
  end;
end $$;

do $$
begin
  begin
    perform toggler_repost_publication(current_setting('app.tmp_p4')::uuid);
    raise exception 'TEST FAILED: a publication with autorise_repost=personne was reposted';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    if sqlerrm not like '%not allowed by the author%' then
      raise exception 'TEST FAILED: rejected for the wrong reason: %', sqlerrm;
    end if;
    raise notice 'PASS: toggler_repost_publication() (first repost) rejects autorise_repost=personne';
  end;
end $$;
reset role;

select set_config('app.current_user_id', '00320004-0000-0000-0000-000000000004', false);
set role authenticated;
do $$
begin
  perform masquer_publication(current_setting('app.tmp_p4')::uuid, true);
end $$;
reset role;

select set_config('app.current_user_id', '00320002-0000-0000-0000-000000000002', false);
set role authenticated;
do $$
begin
  begin
    perform toggler_repost_publication(current_setting('app.tmp_p4')::uuid);
    raise exception 'TEST FAILED: a masked publication was reposted';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    if sqlerrm not like '%hidden%' then
      raise exception 'TEST FAILED: rejected for the wrong reason: %', sqlerrm;
    end if;
    raise notice 'PASS: toggler_repost_publication() (first repost) rejects a masked target';
  end;
end $$;
reset role;

-- The actual toggle: first call creates, second deletes, third recreates.
select set_config('app.current_user_id', '00320002-0000-0000-0000-000000000002', false);
set role authenticated;
do $$
declare v_reposted boolean; v_new_id uuid; v_repost_id uuid;
begin
  select reposted, id into v_reposted, v_new_id from toggler_repost_publication(current_setting('app.tmp_p2')::uuid);
  if v_reposted is distinct from true or v_new_id is null then
    raise exception 'TEST FAILED: first toggle should create a repost (reposted=true, id set), got reposted=%, id=%', v_reposted, v_new_id;
  end if;
  perform set_config('app.tmp_repost_id', v_new_id::text, false);

  select reposted into v_reposted from toggler_repost_publication(current_setting('app.tmp_p2')::uuid);
  if v_reposted is distinct from false then
    raise exception 'TEST FAILED: second toggle should delete the repost (reposted=false), got %', v_reposted;
  end if;

  select reposted into v_reposted from toggler_repost_publication(current_setting('app.tmp_p2')::uuid);
  if v_reposted is distinct from true then
    raise exception 'TEST FAILED: third toggle should recreate the repost (reposted=true), got %', v_reposted;
  end if;
  raise notice 'PASS: toggler_repost_publication() toggles both ways (create -> delete -> create), with a genuine DELETE on toggle-off';
end $$;
reset role;

-- Independently confirm, as the superuser (not just trusting the RPC's
-- own return value), that the toggle-off really deleted the row rather
-- than e.g. just flipping a flag.
do $$
begin
  if exists (select 1 from publications where id = current_setting('app.tmp_repost_id')::uuid) then
    raise exception 'TEST FAILED: the repost row from the first toggle should have been genuinely deleted, but still exists';
  end if;
  raise notice 'PASS: the deleted repost row is confirmed gone at the database level (not just per the RPC''s own return value)';
end $$;

-- Reposting a repost is still rejected on a first attempt (unrelated
-- caller tries to repost the repost row B just created above). The
-- repost's id is looked up as the superuser (this session's default
-- role, before any SET ROLE) and stashed into a GUC -- reading the raw
-- publications table directly as authenticated hits "permission denied"
-- in this stub_auth.sql harness (no table-level grants, only RLS), same
-- gotcha already documented for Lot 5b's report-id lookups.
do $$
declare v_repost_id uuid;
begin
  select id into v_repost_id from publications
    where auteur_id = '00320002-0000-0000-0000-000000000002' and repost_de_id = current_setting('app.tmp_p2')::uuid;
  perform set_config('app.tmp_repost_of_p2', v_repost_id::text, false);
end $$;

select set_config('app.current_user_id', '00320001-0000-0000-0000-000000000001', false);
set role authenticated;
do $$
begin
  begin
    perform toggler_repost_publication(current_setting('app.tmp_repost_of_p2')::uuid);
    raise exception 'TEST FAILED: a repost of a repost was accepted';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    if sqlerrm not like '%cannot repost a repost%' then
      raise exception 'TEST FAILED: rejected for the wrong reason: %', sqlerrm;
    end if;
    raise notice 'PASS: toggler_repost_publication() still rejects reposting a repost';
  end;
end $$;
reset role;

-- This RPC can never delete a row that isn't a repost: calling it on a
-- PLAIN post the caller themselves authored (with no repost referencing
-- it yet) takes the create path, not a delete -- the DELETE's own WHERE
-- clause (repost_de_id = target) can structurally never match the
-- target's own row (a plain post always has repost_de_id null).
-- Contenu is read before/after as the superuser, bracketing the RPC call
-- itself (which must run as the real caller) -- same permission-denied
-- gotcha as above.
do $$
declare v_contenu_before text;
begin
  select contenu into v_contenu_before from publications where id = current_setting('app.tmp_p2')::uuid;
  perform set_config('app.tmp_p2_contenu_before', v_contenu_before, false);
end $$;

select set_config('app.current_user_id', '00320001-0000-0000-0000-000000000001', false);
set role authenticated;
do $$
declare v_reposted boolean;
begin
  select reposted into v_reposted from toggler_repost_publication(current_setting('app.tmp_p2')::uuid);
  if v_reposted is distinct from true then
    raise exception 'TEST FAILED: reposting one''s own plain post for the first time should still create a repost (reposted=true), got %', v_reposted;
  end if;
end $$;
reset role;

do $$
declare v_contenu_after text;
begin
  select contenu into v_contenu_after from publications where id = current_setting('app.tmp_p2')::uuid;
  if v_contenu_after is distinct from current_setting('app.tmp_p2_contenu_before') then
    raise exception 'TEST FAILED: the target plain post was altered/deleted by this RPC (before=%, after=%)',
      current_setting('app.tmp_p2_contenu_before'), v_contenu_after;
  end if;
  raise notice 'PASS: toggler_repost_publication() never deletes a non-repost row -- the target publication survives untouched';
end $$;

-- Quota release: B already has a repost of P2 from the toggle sequence
-- above. Fill the rest of the rate limit, confirm an 11th action is
-- rejected, toggle off the repost of P2, confirm a slot is freed, then
-- confirm B can repost again. B's current row count is read as the
-- superuser first (same permission-denied gotcha as above) and stashed
-- into a GUC for the loop bound.
do $$
declare v_count int;
begin
  select count(*) into v_count from publications where auteur_id = '00320002-0000-0000-0000-000000000002';
  perform set_config('app.tmp_b_count', v_count::text, false);
end $$;

select set_config('app.current_user_id', '00320002-0000-0000-0000-000000000002', false);
set role authenticated;
do $$
declare i int;
begin
  for i in 1..(10 - current_setting('app.tmp_b_count')::int) loop
    perform publier_message('0032 B filler ' || i, null, 'public', 'tous');
  end loop;
end $$;
reset role;

do $$
declare v_count int;
begin
  select count(*) into v_count from publications where auteur_id = '00320002-0000-0000-0000-000000000002';
  if v_count != 10 then
    raise exception 'TEST FAILED: expected B to be at exactly 10 rows, got %', v_count;
  end if;
end $$;

select set_config('app.current_user_id', '00320001-0000-0000-0000-000000000001', false);
set role authenticated;
select publier_message('0032 P5 quota target', null, 'public', 'tous');
reset role;

do $$
declare v_id uuid;
begin
  select id into v_id from publications where contenu = '0032 P5 quota target';
  perform set_config('app.tmp_p5', v_id::text, false);
end $$;

select set_config('app.current_user_id', '00320002-0000-0000-0000-000000000002', false);
set role authenticated;
do $$
begin
  begin
    perform toggler_repost_publication(current_setting('app.tmp_p5')::uuid);
    raise exception 'TEST FAILED: a new repost succeeded at 10/10 rate limit';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    if sqlerrm not like '%rate limit%' then
      raise exception 'TEST FAILED: rejected for the wrong reason: %', sqlerrm;
    end if;
    raise notice 'PASS: at 10/10, a new repost is rejected by the rate limit';
  end;
end $$;

-- Toggle off the existing repost of P2 -- frees a slot.
select reposted from toggler_repost_publication(current_setting('app.tmp_p2')::uuid);
reset role;

do $$
declare v_count int;
begin
  select count(*) into v_count from publications where auteur_id = '00320002-0000-0000-0000-000000000002';
  if v_count != 9 then
    raise exception 'TEST FAILED: expected 9 rows after toggling off, got %', v_count;
  end if;
  raise notice 'PASS: toggling a repost off releases a quota slot';
end $$;

select set_config('app.current_user_id', '00320002-0000-0000-0000-000000000002', false);
set role authenticated;
do $$
declare v_reposted boolean;
begin
  select reposted into v_reposted from toggler_repost_publication(current_setting('app.tmp_p5')::uuid);
  if v_reposted is distinct from true then
    raise exception 'TEST FAILED: B should be able to repost again after the quota was freed, got reposted=%', v_reposted;
  end if;
  raise notice 'PASS: B can repost again once the quota is freed';
end $$;
reset role;

-- Grants: anon none, NULL auth.uid() rejected, authenticated holds
-- EXECUTE, on the renamed function.
select set_config('app.current_user_id', '', false);
set role anon;
do $$
begin
  begin
    perform toggler_repost_publication('00000000-0000-0000-0000-000000000000');
    raise exception 'TEST FAILED: anon could call toggler_repost_publication()';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no EXECUTE on toggler_repost_publication()';
  end;
end $$;
reset role;

select set_config('app.current_user_id', '', false);
set role authenticated;
do $$
begin
  begin
    perform toggler_repost_publication('00000000-0000-0000-0000-000000000000');
    raise exception 'TEST FAILED: authenticated with a NULL auth.uid() could call toggler_repost_publication()';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    if sqlerrm != 'not authenticated' then
      raise exception 'TEST FAILED: unexpected error: %', sqlerrm;
    end if;
    raise notice 'PASS: toggler_repost_publication() rejects a NULL auth.uid()';
  end;
end $$;
reset role;

do $$
begin
  if not has_function_privilege('authenticated', 'toggler_repost_publication(uuid)', 'EXECUTE') then
    raise exception 'TEST FAILED: authenticated lost EXECUTE on toggler_repost_publication()';
  end if;
  raise notice 'PASS: authenticated holds EXECUTE on toggler_repost_publication()';
end $$;

-- ---------------------------------------------------------------------
-- Security audit fix (migration 0033): anon must have no SELECT on
-- publications_accueil at all -- /home now requires a session (see
-- src/app/[locale]/(app)/home/page.tsx's own redirect guard), so the
-- view backing it no longer needs anon access. publications_visibles
-- must be completely unaffected -- it backs /[handle] and the Lot 5c
-- permalink page (/[handle]/p/[id]), both of which must stay reachable
-- by a logged-out visitor for external sharing to work at all.
-- ---------------------------------------------------------------------
select set_config('app.current_user_id', '', false);
set role anon;

do $$
begin
  begin
    perform 1 from public.publications_accueil limit 1;
    raise exception 'TEST FAILED: anon was able to SELECT from publications_accueil at all';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no SELECT privilege on publications_accueil (migration 0033)';
  end;
end $$;

do $$
begin
  -- No exception handler on purpose -- this must simply succeed (real
  -- Postgres permission check, not just "did the query not error out of
  -- an unrelated reason"); a zero-row result is still a pass, since the
  -- point here is the grant itself, not any specific fixture data.
  perform 1 from public.publications_visibles limit 1;
  raise notice 'PASS: anon still has SELECT on publications_visibles (unaffected by migration 0033)';
end $$;

reset role;

do $$
begin
  if has_table_privilege('anon', 'public.publications_accueil', 'SELECT') then
    raise exception 'TEST FAILED: has_table_privilege still reports anon holding SELECT on publications_accueil';
  end if;
  raise notice 'PASS: has_table_privilege confirms anon lost SELECT on publications_accueil';
end $$;

do $$
begin
  if not has_table_privilege('anon', 'public.publications_visibles', 'SELECT') then
    raise exception 'TEST FAILED: anon lost SELECT on publications_visibles -- external sharing would break';
  end if;
  raise notice 'PASS: has_table_privilege confirms anon still holds SELECT on publications_visibles';
end $$;

do $$
begin
  if not has_table_privilege('authenticated', 'public.publications_accueil', 'SELECT') then
    raise exception 'TEST FAILED: authenticated lost SELECT on publications_accueil -- /home would break for logged-in users too';
  end if;
  raise notice 'PASS: authenticated still holds SELECT on publications_accueil';
end $$;

-- =======================================================================
-- Lot 6a: in-app notifications (migration 0034). Fixture: créateur A
-- (verified, so A can post), fan B, admin D (deliberately not itself
-- createur_verifie, same "an admin's own verification status is
-- irrelevant" convention as earlier lots).
-- =======================================================================
insert into users (id, createur_verifie, est_admin) values
  ('60000001-0000-0000-0000-000000000001', true, false),
  ('60000002-0000-0000-0000-000000000002', false, false),
  ('60000004-0000-0000-0000-000000000004', false, true);

insert into offres (id, createur_id, type, prix) values
  ('60000010-0000-0000-0000-000000000010', '60000001-0000-0000-0000-000000000001', 'video', 10);

insert into transactions (id, fan_id, createur_id, offre_id, montant, statut) values
  ('60000020-0000-0000-0000-000000000020', '60000002-0000-0000-0000-000000000002', '60000001-0000-0000-0000-000000000001', '60000010-0000-0000-0000-000000000010', 10, 'en_attente'),
  ('60000021-0000-0000-0000-000000000021', '60000002-0000-0000-0000-000000000002', '60000001-0000-0000-0000-000000000001', '60000010-0000-0000-0000-000000000010', 10, 'en_attente'),
  ('60000022-0000-0000-0000-000000000022', '60000002-0000-0000-0000-000000000002', '60000001-0000-0000-0000-000000000001', '60000010-0000-0000-0000-000000000010', 10, 'en_attente'),
  ('60000023-0000-0000-0000-000000000023', '60000002-0000-0000-0000-000000000002', '60000001-0000-0000-0000-000000000001', '60000010-0000-0000-0000-000000000010', 10, 'en_attente');

-- creer_notification() has no direct EXECUTE for anyone but service_role
-- -- it takes an arbitrary destinataire/acteur with no ownership check
-- of its own, so a direct authenticated (or anon) call would let anyone
-- fake a notification impersonating any acteur, for any recipient.
select set_config('app.current_user_id', '60000001-0000-0000-0000-000000000001', false);
set role authenticated;
do $$
begin
  begin
    perform creer_notification('60000002-0000-0000-0000-000000000002', 'demande_recue');
    raise exception 'TEST FAILED: authenticated was able to call creer_notification() directly';
  exception when insufficient_privilege then
    raise notice 'PASS: authenticated has no direct EXECUTE on creer_notification()';
  end;
end $$;
reset role;

select set_config('app.current_user_id', '', false);
set role anon;
do $$
begin
  begin
    perform creer_notification('60000002-0000-0000-0000-000000000002', 'demande_recue');
    raise exception 'TEST FAILED: anon was able to call creer_notification() directly';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no EXECUTE on creer_notification()';
  end;
end $$;
reset role;

do $$
begin
  if has_function_privilege('service_role', 'creer_notification(uuid,text,uuid,uuid,uuid)', 'EXECUTE') = false then
    raise exception 'TEST FAILED: service_role lost EXECUTE on creer_notification() -- the webhook''s direct call would break';
  end if;
  raise notice 'PASS: service_role holds EXECUTE on creer_notification() (needed for the CinetPay webhook''s direct call)';
end $$;

-- accept_transaction() internally calling creer_notification() despite
-- no direct authenticated grant on it -- the real point of this whole
-- design, verified here rather than just assumed (see CLAUDE.md).
select set_config('app.current_user_id', '60000001-0000-0000-0000-000000000001', false);
set role authenticated;
select accept_transaction('60000020-0000-0000-0000-000000000020');
reset role;

do $$
declare v_count int;
begin
  select count(*) into v_count from notifications
    where destinataire_id = '60000002-0000-0000-0000-000000000002'
      and type = 'demande_acceptee'
      and transaction_id = '60000020-0000-0000-0000-000000000020'
      and acteur_id = '60000001-0000-0000-0000-000000000001';
  if v_count != 1 then
    raise exception 'TEST FAILED: expected exactly 1 demande_acceptee notification for B, got %', v_count;
  end if;
  raise notice 'PASS: accept_transaction() notifies the fan (demande_acceptee) with the créateur as acteur';
end $$;

-- refuse_transaction() -> demande_refusee to B.
select set_config('app.current_user_id', '60000001-0000-0000-0000-000000000001', false);
set role authenticated;
select refuse_transaction('60000021-0000-0000-0000-000000000021');
reset role;

do $$
declare v_count int;
begin
  select count(*) into v_count from notifications
    where destinataire_id = '60000002-0000-0000-0000-000000000002'
      and type = 'demande_refusee'
      and transaction_id = '60000021-0000-0000-0000-000000000021';
  if v_count != 1 then
    raise exception 'TEST FAILED: expected exactly 1 demande_refusee notification for B, got %', v_count;
  end if;
  raise notice 'PASS: refuse_transaction() notifies the fan (demande_refusee)';
end $$;

-- deliver_video() -> video_livree to B (TX 20 is already validee from
-- the accept_transaction() call above).
select set_config('app.current_user_id', '60000001-0000-0000-0000-000000000001', false);
set role authenticated;
select deliver_video('60000020-0000-0000-0000-000000000020', 'videos/test-6a.mp4');
reset role;

do $$
declare v_count int;
begin
  select count(*) into v_count from notifications
    where destinataire_id = '60000002-0000-0000-0000-000000000002'
      and type = 'video_livree'
      and transaction_id = '60000020-0000-0000-0000-000000000020';
  if v_count != 1 then
    raise exception 'TEST FAILED: expected exactly 1 video_livree notification for B, got %', v_count;
  end if;
  raise notice 'PASS: deliver_video() notifies the fan (video_livree)';
end $$;

-- confirmer_livraison_fan() -> confirmation_recue to A, acteur = B.
select set_config('app.current_user_id', '60000002-0000-0000-0000-000000000002', false);
set role authenticated;
select confirmer_livraison_fan('60000020-0000-0000-0000-000000000020');
reset role;

do $$
declare v_count int;
begin
  select count(*) into v_count from notifications
    where destinataire_id = '60000001-0000-0000-0000-000000000001'
      and type = 'confirmation_recue'
      and transaction_id = '60000020-0000-0000-0000-000000000020'
      and acteur_id = '60000002-0000-0000-0000-000000000002';
  if v_count != 1 then
    raise exception 'TEST FAILED: expected exactly 1 confirmation_recue notification for A, got %', v_count;
  end if;
  raise notice 'PASS: confirmer_livraison_fan() notifies the créateur (confirmation_recue) with the fan as acteur';
end $$;

-- contester_livraison_fan() + resoudre_litige() -- two transactions, one
-- resolved faveur_createur, one faveur_fan, to prove the notification
-- recipient tracks the decision, not a fixed party.
select set_config('app.current_user_id', '60000001-0000-0000-0000-000000000001', false);
set role authenticated;
select accept_transaction('60000022-0000-0000-0000-000000000022');
select deliver_video('60000022-0000-0000-0000-000000000022', 'videos/test-6a-contest1.mp4');
select accept_transaction('60000023-0000-0000-0000-000000000023');
select deliver_video('60000023-0000-0000-0000-000000000023', 'videos/test-6a-contest2.mp4');
reset role;

select set_config('app.current_user_id', '60000002-0000-0000-0000-000000000002', false);
set role authenticated;
select contester_livraison_fan('60000022-0000-0000-0000-000000000022');
select contester_livraison_fan('60000023-0000-0000-0000-000000000023');
reset role;

do $$
declare v_count int;
begin
  select count(*) into v_count from notifications
    where destinataire_id = '60000001-0000-0000-0000-000000000001'
      and type = 'contestation_recue'
      and acteur_id = '60000002-0000-0000-0000-000000000002'
      and transaction_id in ('60000022-0000-0000-0000-000000000022', '60000023-0000-0000-0000-000000000023');
  if v_count != 2 then
    raise exception 'TEST FAILED: expected exactly 2 contestation_recue notifications for A, got %', v_count;
  end if;
  raise notice 'PASS: contester_livraison_fan() notifies the créateur (contestation_recue) with the fan as acteur';
end $$;

select set_config('app.current_user_id', '60000004-0000-0000-0000-000000000004', false);
set role authenticated;
select resoudre_litige('60000022-0000-0000-0000-000000000022', 'faveur_createur');
select resoudre_litige('60000023-0000-0000-0000-000000000023', 'faveur_fan');
reset role;

do $$
declare v_count int;
begin
  select count(*) into v_count from notifications
    where destinataire_id = '60000001-0000-0000-0000-000000000001'
      and type = 'litige_tranche_createur'
      and transaction_id = '60000022-0000-0000-0000-000000000022'
      and acteur_id = '60000004-0000-0000-0000-000000000004';
  if v_count != 1 then
    raise exception 'TEST FAILED: expected exactly 1 litige_tranche_createur notification for A, got %', v_count;
  end if;

  select count(*) into v_count from notifications
    where destinataire_id = '60000002-0000-0000-0000-000000000002'
      and type = 'litige_tranche_fan'
      and transaction_id = '60000023-0000-0000-0000-000000000023'
      and acteur_id = '60000004-0000-0000-0000-000000000004';
  if v_count != 1 then
    raise exception 'TEST FAILED: expected exactly 1 litige_tranche_fan notification for B, got %', v_count;
  end if;
  raise notice 'PASS: resoudre_litige() notifies whichever party the decision favored (litige_tranche_createur/litige_tranche_fan), with the admin as acteur';
end $$;

-- traiter_retrait() -> retrait_traite/retrait_refuse to the créateur who
-- requested it, with no transaction_id/publication_id (this event is
-- about a demandes_retrait row, not either of those).
insert into demandes_retrait (id, createur_id, montant, statut) values
  ('60000030-0000-0000-0000-000000000030', '60000001-0000-0000-0000-000000000001', 25, 'en_attente'),
  ('60000031-0000-0000-0000-000000000031', '60000001-0000-0000-0000-000000000001', 25, 'en_attente');

select set_config('app.current_user_id', '60000004-0000-0000-0000-000000000004', false);
set role authenticated;
select traiter_retrait('60000030-0000-0000-0000-000000000030', 'traite');
select traiter_retrait('60000031-0000-0000-0000-000000000031', 'refuse');
reset role;

do $$
declare v_count int;
begin
  select count(*) into v_count from notifications
    where destinataire_id = '60000001-0000-0000-0000-000000000001'
      and type = 'retrait_traite'
      and acteur_id = '60000004-0000-0000-0000-000000000004'
      and transaction_id is null and publication_id is null;
  if v_count != 1 then
    raise exception 'TEST FAILED: expected exactly 1 retrait_traite notification for A, got %', v_count;
  end if;

  select count(*) into v_count from notifications
    where destinataire_id = '60000001-0000-0000-0000-000000000001'
      and type = 'retrait_refuse'
      and acteur_id = '60000004-0000-0000-0000-000000000004';
  if v_count != 1 then
    raise exception 'TEST FAILED: expected exactly 1 retrait_refuse notification for A, got %', v_count;
  end if;
  raise notice 'PASS: traiter_retrait() notifies the créateur (retrait_traite/retrait_refuse), with no transaction_id/publication_id set';
end $$;

-- toggler_like_publication(): notifies ONLY on the like branch, and
-- NEVER on a self-like -- both checked explicitly, not just assumed from
-- "no error was raised".
select set_config('app.current_user_id', '60000001-0000-0000-0000-000000000001', false);
set role authenticated;
select publier_message('Lot 6a test post', null, 'public', 'tous');
reset role;

do $$
declare v_pub uuid;
begin
  select id into v_pub from publications where contenu = 'Lot 6a test post';
  perform set_config('app.tmp_6a_pub', v_pub::text, false);
end $$;

-- B likes A's post -> exactly 1 publication_aimee notification for A.
select set_config('app.current_user_id', '60000002-0000-0000-0000-000000000002', false);
set role authenticated;
select toggler_like_publication(current_setting('app.tmp_6a_pub')::uuid);
reset role;

do $$
declare v_count int;
begin
  select count(*) into v_count from notifications
    where destinataire_id = '60000001-0000-0000-0000-000000000001'
      and type = 'publication_aimee'
      and publication_id = current_setting('app.tmp_6a_pub')::uuid
      and acteur_id = '60000002-0000-0000-0000-000000000002';
  if v_count != 1 then
    raise exception 'TEST FAILED: expected exactly 1 publication_aimee notification after B''s like, got %', v_count;
  end if;
  raise notice 'PASS: toggler_like_publication() notifies the auteur (publication_aimee) on the like branch';
end $$;

-- A likes their OWN post -> succeeds (liked=true) but must create NO
-- notification at all -- nobody needs to be told they liked their own
-- post.
select set_config('app.current_user_id', '60000001-0000-0000-0000-000000000001', false);
set role authenticated;
select toggler_like_publication(current_setting('app.tmp_6a_pub')::uuid);
reset role;

-- B un-likes (the toggle-off branch) -> must not create a second
-- notification either.
select set_config('app.current_user_id', '60000002-0000-0000-0000-000000000002', false);
set role authenticated;
select toggler_like_publication(current_setting('app.tmp_6a_pub')::uuid);
reset role;

do $$
declare v_count int;
begin
  select count(*) into v_count from notifications
    where publication_id = current_setting('app.tmp_6a_pub')::uuid
      and type = 'publication_aimee';
  if v_count != 1 then
    raise exception 'TEST FAILED: expected the publication_aimee count to stay at 1 (no self-like, no unlike notification), got %', v_count;
  end if;
  raise notice 'PASS: neither a self-like nor an unlike creates any (additional) publication_aimee notification';
end $$;

-- marquer_notifications_lues() -- marks every one of the caller's own
-- unread notifications read, and nobody else's.
do $$
declare v_unread_b int;
begin
  select count(*) into v_unread_b from notifications
    where destinataire_id = '60000002-0000-0000-0000-000000000002' and lu = false;
  if v_unread_b = 0 then
    raise exception 'TEST FAILED: précondition -- B should have unread notifications before calling marquer_notifications_lues()';
  end if;
end $$;

select set_config('app.current_user_id', '60000002-0000-0000-0000-000000000002', false);
set role authenticated;
select marquer_notifications_lues();
reset role;

do $$
declare v_unread_b int; v_unread_a int;
begin
  select count(*) into v_unread_b from notifications
    where destinataire_id = '60000002-0000-0000-0000-000000000002' and lu = false;
  if v_unread_b != 0 then
    raise exception 'TEST FAILED: B still has % unread notifications after calling marquer_notifications_lues()', v_unread_b;
  end if;

  select count(*) into v_unread_a from notifications
    where destinataire_id = '60000001-0000-0000-0000-000000000001' and lu = false;
  if v_unread_a = 0 then
    raise exception 'TEST FAILED: A''s own notifications were marked read by B''s call -- marquer_notifications_lues() is not scoped to the caller';
  end if;
  raise notice 'PASS: marquer_notifications_lues() marks only the caller''s own notifications read, leaving everyone else''s untouched';
end $$;

-- marquer_notifications_lues(): anon has no EXECUTE, authenticated with
-- a NULL auth.uid() is rejected.
select set_config('app.current_user_id', '', false);
set role anon;
do $$
begin
  begin
    perform marquer_notifications_lues();
    raise exception 'TEST FAILED: anon was able to call marquer_notifications_lues()';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no EXECUTE on marquer_notifications_lues()';
  end;
end $$;
reset role;

select set_config('app.current_user_id', '', false);
set role authenticated;
do $$
begin
  begin
    perform marquer_notifications_lues();
    raise exception 'TEST FAILED: authenticated with a NULL auth.uid() was able to call marquer_notifications_lues()';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    if sqlerrm != 'not authenticated' then
      raise exception 'TEST FAILED: unexpected error: %', sqlerrm;
    end if;
    raise notice 'PASS: marquer_notifications_lues() rejects a NULL auth.uid()';
  end;
end $$;
reset role;

do $$
begin
  if not has_function_privilege('authenticated', 'marquer_notifications_lues()', 'EXECUTE') then
    raise exception 'TEST FAILED: authenticated lost EXECUTE on marquer_notifications_lues()';
  end if;
  raise notice 'PASS: authenticated holds EXECUTE on marquer_notifications_lues()';
end $$;

-- ---------------------------------------------------------------------
-- Cover photo (migration 0035): a plain nullable column plus a view
-- passthrough, no trigger/constraint/RPC involved -- still verified
-- directly rather than just described, same discipline as every other
-- migration in this file. Reuses fixture user 1
-- (11111111-1111-1111-1111-111111111111) and the untouched fixture
-- user 2 (22222222-2222-2222-2222-222222222222) as the "never set it"
-- control.
-- ---------------------------------------------------------------------
update users set photo_couverture_r2_key = 'profils/11111111-1111-1111-1111-111111111111/cover.jpg'
  where id = '11111111-1111-1111-1111-111111111111';

do $$
declare
  v_set text;
  v_unset text;
begin
  select photo_couverture_r2_key into v_set from profils_publics
    where id = '11111111-1111-1111-1111-111111111111';
  if v_set is distinct from 'profils/11111111-1111-1111-1111-111111111111/cover.jpg' then
    raise exception 'TEST FAILED: profils_publics does not expose photo_couverture_r2_key correctly (got %)', v_set;
  end if;

  select photo_couverture_r2_key into v_unset from profils_publics
    where id = '22222222-2222-2222-2222-222222222222';
  if v_unset is not null then
    raise exception 'TEST FAILED: photo_couverture_r2_key should default to null for a user who never set it (got %)', v_unset;
  end if;

  raise notice 'PASS: profils_publics exposes photo_couverture_r2_key, null by default, correct once set';
end $$;

-- =======================================================================
-- Publications: video support (migration 0037). Fixture: créateur A
-- (verified, posts a soutiens-only video and a public, repostable
-- video), fan B (a real supporter of A via a livree transaction, same
-- soutient_createur mechanism as Lot 5a), fan C (a stranger), créateur D
-- (verified, reposts A's public video post).
-- =======================================================================
insert into users (id, createur_verifie, est_admin) values
  ('7d000001-0000-0000-0000-000000000001', true, false),
  ('7d000002-0000-0000-0000-000000000002', false, false),
  ('7d000003-0000-0000-0000-000000000003', false, false),
  ('7d000004-0000-0000-0000-000000000004', true, false);

insert into offres (id, createur_id, type, prix) values
  ('7d000010-0000-0000-0000-000000000010', '7d000001-0000-0000-0000-000000000001', 'don', null);

insert into transactions (id, fan_id, createur_id, offre_id, montant, statut) values
  ('7d000011-0000-0000-0000-000000000011',
   '7d000002-0000-0000-0000-000000000002',
   '7d000001-0000-0000-0000-000000000001',
   '7d000010-0000-0000-0000-000000000010', 10, 'livree');

-- publications_media_exclusif is the real DB-level guarantee against a
-- publication ever carrying both an image and a video at once -- checked
-- directly against the raw table (superuser, bypassing publier_message()
-- entirely), same "prove the constraint itself, not just an RPC's
-- refusal to attempt it" discipline as check_whatsapp_minimum_price/
-- users_pseudo_not_reserved elsewhere in this file.
do $$
begin
  begin
    insert into publications (auteur_id, type, contenu, image_r2_key, video_r2_key, visibilite)
      values ('7d000001-0000-0000-0000-000000000001', 'createur', 'both at once',
              'publications/7d000001/img.jpg', 'publications/7d000001/vid.mp4', 'public');
    raise exception 'TEST FAILED: a publication with both image_r2_key and video_r2_key was accepted';
  exception when check_violation then
    raise notice 'PASS: publications_media_exclusif rejects a publication with both an image and a video';
  end;
end $$;

-- A posts a soutiens-only video (teaser test, below) and a public,
-- repostable video (repost test, below) -- named-parameter notation used
-- specifically to set p_video_r2_key without also having to spell out
-- the unused p_image_r2_key/p_autorise_repost positionally.
select set_config('app.current_user_id', '7d000001-0000-0000-0000-000000000001', false);
set role authenticated;
select publier_message(
  p_contenu := 'video soutiens only',
  p_visibilite := 'soutiens',
  p_video_r2_key := 'publications/7d000001/soutiens.mp4'
);
select publier_message(
  p_contenu := 'video public repostable',
  p_visibilite := 'public',
  p_autorise_repost := 'tous',
  p_video_r2_key := 'publications/7d000001/public.mp4'
);
reset role;

do $$
declare
  v_pub_soutiens uuid;
  v_pub_public uuid;
  v_key text;
begin
  select id into v_pub_soutiens from publications where contenu = 'video soutiens only';
  select id into v_pub_public from publications where contenu = 'video public repostable';
  perform set_config('app.tmp_video_soutiens', v_pub_soutiens::text, false);
  perform set_config('app.tmp_video_public', v_pub_public::text, false);

  -- Confirms publier_message() actually persisted p_video_r2_key at the
  -- raw table level, before ever checking the view's own teaser logic.
  select video_r2_key into v_key from publications where id = v_pub_soutiens;
  if v_key is distinct from 'publications/7d000001/soutiens.mp4' then
    raise exception 'TEST FAILED: publier_message() did not persist p_video_r2_key (got %)', v_key;
  end if;
  raise notice 'PASS: publier_message() persists video_r2_key exactly as passed';
end $$;

-- Stranger C cannot fully see the soutiens-only video post -- video_r2_key
-- must never leak, the exact same guarantee already proven for
-- image_r2_key in Lot 5a.
select set_config('app.current_user_id', '7d000003-0000-0000-0000-000000000003', false);
set role authenticated;
do $$
declare
  v_video text;
  v_complet boolean;
begin
  select video_r2_key, contenu_complet into v_video, v_complet
    from publications_visibles where id = current_setting('app.tmp_video_soutiens')::uuid;
  if v_video is not null then
    raise exception 'TEST FAILED: video_r2_key leaked to a stranger on a soutiens-only publication (got %)', v_video;
  end if;
  if v_complet is distinct from false then
    raise exception 'TEST FAILED: contenu_complet should be a clean false for a stranger, got %', v_complet;
  end if;
  raise notice 'PASS: video_r2_key is never leaked to an unauthorized viewer on a soutiens-only publication (same guarantee as image_r2_key)';
end $$;
reset role;

-- A real supporter (B) sees the video in full.
select set_config('app.current_user_id', '7d000002-0000-0000-0000-000000000002', false);
set role authenticated;
do $$
declare
  v_video text;
  v_complet boolean;
begin
  select video_r2_key, contenu_complet into v_video, v_complet
    from publications_visibles where id = current_setting('app.tmp_video_soutiens')::uuid;
  if v_video is distinct from 'publications/7d000001/soutiens.mp4' then
    raise exception 'TEST FAILED: a real supporter should see the real video_r2_key (got %)', v_video;
  end if;
  if v_complet is distinct from true then
    raise exception 'TEST FAILED: contenu_complet should be true for a real supporter, got %', v_complet;
  end if;
  raise notice 'PASS: a real supporter sees the full video_r2_key on a soutiens-only publication';
end $$;
reset role;

-- D (a second verified créateur) reposts A's public video post -- the
-- repost's own row never carries a video_r2_key (toggler_repost_publication()
-- never sets one on the row it inserts), but the EMBEDDED original --
-- resolved via repost_de_id, the same way the app's own
-- hydratePublications() does -- still exposes the real video, since the
-- original itself is public.
select set_config('app.current_user_id', '7d000004-0000-0000-0000-000000000004', false);
set role authenticated;
select toggler_repost_publication(current_setting('app.tmp_video_public')::uuid);
reset role;

do $$
declare
  v_repost_id uuid;
  v_repost_video text;
  v_original_video text;
begin
  select id, video_r2_key into v_repost_id, v_repost_video from publications_visibles
    where repost_de_id = current_setting('app.tmp_video_public')::uuid
      and auteur_id = '7d000004-0000-0000-0000-000000000004';

  if v_repost_id is null then
    raise exception 'TEST FAILED: expected repost row not found';
  end if;
  if v_repost_video is not null then
    raise exception 'TEST FAILED: a repost row should never carry its own video_r2_key (got %)', v_repost_video;
  end if;

  select video_r2_key into v_original_video from publications_visibles
    where id = current_setting('app.tmp_video_public')::uuid;
  if v_original_video is distinct from 'publications/7d000001/public.mp4' then
    raise exception 'TEST FAILED: the reposted original should still expose its real video_r2_key (got %)', v_original_video;
  end if;

  raise notice 'PASS: reposting a video publication carries the video through via the embedded original, exactly like an image would';
end $$;

-- =======================================================================
-- Phase C: publications_explorables (migration 0038) -- Explorer's
-- publications grid. Same "verified créateurs + FanBoss announcements"
-- population as publications_accueil, narrowed to visibilite='public'
-- only (never a locked "soutiens" teaser in a discovery grid) and
-- respecting masque_exploration (same opt-out profils_explorables
-- already honors), with no mute filter at all (Explorer is a shared
-- discovery surface, not one viewer's personal feed).
--
-- Fixture: créateur E (verified, not opted out -- posts a public post
-- AND a soutiens-only post), créateur F (verified, masque_exploration
-- = true -- posts a public post), créateur G (NOT verified, not admin
-- -- posts a public post), admin H (est_admin, deliberately NOT itself
-- createur_verifie -- posts, forced to annonce_fanboss/public).
-- =======================================================================
insert into users (id, createur_verifie, est_admin, masque_exploration) values
  ('8c000001-0000-0000-0000-000000000001', true, false, false),
  ('8c000002-0000-0000-0000-000000000002', true, false, true),
  ('8c000003-0000-0000-0000-000000000003', false, false, false),
  ('8c000004-0000-0000-0000-000000000004', false, true, false);

select set_config('app.current_user_id', '8c000001-0000-0000-0000-000000000001', false);
set role authenticated;
select publier_message(p_contenu := 'explorer public post from E', p_visibilite := 'public');
select publier_message(p_contenu := 'explorer soutiens post from E', p_visibilite := 'soutiens');
reset role;

select set_config('app.current_user_id', '8c000002-0000-0000-0000-000000000002', false);
set role authenticated;
select publier_message(p_contenu := 'explorer public post from F', p_visibilite := 'public');
reset role;

-- G is deliberately not verified and not admin -- publier_message()
-- itself would reject this exact call ("not authorized"), so this row
-- is inserted directly (superuser, bypassing the RPC entirely), same
-- "prove the view's own filter, not an RPC's refusal to attempt it"
-- shape as the publications_media_exclusif test above. The scenario this
-- proves is real regardless: a créateur who later loses verified status
-- (or an inconsistent row for any other reason) must not linger in the
-- Explorer grid either way.
insert into publications (auteur_id, type, contenu, visibilite) values
  ('8c000003-0000-0000-0000-000000000003', 'createur', 'explorer public post from G', 'public');

select set_config('app.current_user_id', '8c000004-0000-0000-0000-000000000004', false);
set role authenticated;
select publier_message(p_contenu := 'explorer FanBoss announcement from H');
reset role;

do $$
begin
  if not exists (
    select 1 from publications_explorables
    where auteur_id = '8c000001-0000-0000-0000-000000000001'
      and contenu = 'explorer public post from E'
  ) then
    raise exception 'TEST FAILED: a verified créateur''s public post missing from publications_explorables';
  end if;
  raise notice 'PASS: publications_explorables includes a verified créateur''s public post';
end $$;

do $$
begin
  if exists (
    select 1 from publications_explorables
    where auteur_id = '8c000001-0000-0000-0000-000000000001'
      and contenu = 'explorer soutiens post from E'
  ) then
    raise exception 'TEST FAILED: a soutiens-only post appeared in publications_explorables (never even as a teaser)';
  end if;
  raise notice 'PASS: publications_explorables excludes a soutiens-only post entirely -- no locked teaser in a discovery grid';
end $$;

do $$
begin
  if exists (
    select 1 from publications_explorables where auteur_id = '8c000002-0000-0000-0000-000000000002'
  ) then
    raise exception 'TEST FAILED: a masque_exploration=true créateur''s public post appeared in publications_explorables';
  end if;
  raise notice 'PASS: publications_explorables respects masque_exploration, same opt-out as profils_explorables';
end $$;

-- Real bug fix (application-code, no new migration): an active Explorer
-- search must read publications_visibles instead of
-- publications_explorables, precisely because publications_visibles
-- carries no masque_exploration filter at all -- this is the DB-level
-- guarantee getPublicationsExplorables() now relies on for a search to
-- correctly bypass masque_exploration (see src/lib/publications.ts and
-- its own unit tests for the application-side proof of the query shape;
-- this proves the underlying view genuinely has no such restriction to
-- bypass in the first place, same "verify a view's real shape before
-- trusting application code to lean on it" discipline as everywhere
-- else in this file).
do $$
declare
  v_complet boolean;
begin
  if not exists (
    select 1 from publications_visibles where auteur_id = '8c000002-0000-0000-0000-000000000002'
  ) then
    raise exception 'TEST FAILED: a masque_exploration=true créateur''s public post is missing from publications_visibles -- search would have nothing to find';
  end if;

  select contenu_complet into v_complet from publications_visibles
    where auteur_id = '8c000002-0000-0000-0000-000000000002';
  if v_complet is distinct from true then
    raise exception 'TEST FAILED: the masque_exploration=true créateur''s public post should be fully visible (contenu_complet=true) via publications_visibles, got %', v_complet;
  end if;

  raise notice 'PASS: publications_visibles (unlike publications_explorables) carries no masque_exploration filter -- the real guarantee behind the search-bypass fix';
end $$;

do $$
begin
  if exists (
    select 1 from publications_explorables where auteur_id = '8c000003-0000-0000-0000-000000000003'
  ) then
    raise exception 'TEST FAILED: a non-verified, non-admin créateur''s public post appeared in publications_explorables';
  end if;
  raise notice 'PASS: publications_explorables excludes a non-verified créateur''s posts, same population as publications_accueil';
end $$;

do $$
begin
  if not exists (
    select 1 from publications_explorables
    where auteur_id = '8c000004-0000-0000-0000-000000000004' and type = 'annonce_fanboss'
  ) then
    raise exception 'TEST FAILED: a FanBoss announcement missing from publications_explorables';
  end if;
  raise notice 'PASS: publications_explorables includes a FanBoss announcement regardless of the posting admin''s own createur_verifie';
end $$;

-- Reuses Lot 5c/Phase A's own fixture (créateur D, 7d000004, reposting
-- créateur A's public video post) to prove a public repost by a verified
-- créateur appears in publications_explorables too -- the population this
-- grid's own repost badge (client-side) relies on.
do $$
declare
  v_repost_id uuid;
begin
  select id into v_repost_id from publications
    where repost_de_id = current_setting('app.tmp_video_public')::uuid
      and auteur_id = '7d000004-0000-0000-0000-000000000004';

  if not exists (select 1 from publications_explorables where id = v_repost_id) then
    raise exception 'TEST FAILED: a public repost by a verified créateur missing from publications_explorables';
  end if;
  raise notice 'PASS: publications_explorables includes a public repost by a verified créateur';
end $$;

-- Grants: same public-view shape as profils_explorables/
-- publications_visibles -- reachable by anon (no auth required to browse
-- Explorer) and authenticated alike, no SECURITY DEFINER function
-- involved at all (a plain view, so there's no EXECUTE grant to get
-- wrong the way migration 0020 found for accept_transaction()).
select set_config('app.current_user_id', '', false);
set role anon;
do $$
begin
  perform 1 from public.publications_explorables limit 1;
  raise notice 'PASS: anon has SELECT on publications_explorables';
end $$;
reset role;

do $$
begin
  if not has_table_privilege('anon', 'public.publications_explorables', 'SELECT') then
    raise exception 'TEST FAILED: anon lacks SELECT on publications_explorables';
  end if;
  raise notice 'PASS: has_table_privilege confirms anon holds SELECT on publications_explorables';
end $$;

do $$
begin
  if not has_table_privilege('authenticated', 'public.publications_explorables', 'SELECT') then
    raise exception 'TEST FAILED: authenticated lacks SELECT on publications_explorables';
  end if;
  raise notice 'PASS: has_table_privilege confirms authenticated holds SELECT on publications_explorables';
end $$;

-- =======================================================================
-- View counter on publications video, Explorer grid overlay (migration
-- 0043): vues_count + incrementer_vue_publication().
-- =======================================================================

-- incrementer_vue_publication only ever increments a genuine video post
-- -- reuses the real public video fixture from migration 0037's own
-- section above (app.tmp_video_public) rather than a fresh insert, since
-- that publication already has a real video_r2_key.
do $$
declare
  v_before int;
  v_after int;
begin
  select vues_count into v_before from publications
    where id = current_setting('app.tmp_video_public')::uuid;

  perform incrementer_vue_publication(current_setting('app.tmp_video_public')::uuid);

  select vues_count into v_after from publications
    where id = current_setting('app.tmp_video_public')::uuid;

  if v_after != v_before + 1 then
    raise exception 'TEST FAILED: incrementer_vue_publication did not increment a real video post (before=%, after=%)', v_before, v_after;
  end if;
  raise notice 'PASS: incrementer_vue_publication increments vues_count on a genuine video post';
end $$;

-- A text-only post (no video_r2_key at all) is silently left untouched
-- -- the WHERE clause is the real guarantee, not an exception a caller
-- would need to handle; this is what makes the route safely callable
-- without knowing in advance whether a given id is a video post.
insert into publications (id, auteur_id, type, contenu, visibilite) values
  ('9c000001-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'createur', 'text-only post, no video', 'public');

do $$
declare
  v_vues int;
begin
  perform incrementer_vue_publication('9c000001-0000-0000-0000-000000000001');
  select vues_count into v_vues from publications where id = '9c000001-0000-0000-0000-000000000001';
  if v_vues != 0 then
    raise exception 'TEST FAILED: incrementer_vue_publication incremented a text-only post (no video_r2_key) -- got vues_count=%', v_vues;
  end if;
  raise notice 'PASS: incrementer_vue_publication silently no-ops for a publication with no video_r2_key';
end $$;

-- vues_count flows through all three layered views (publications_visibles
-- -> publications_accueil/publications_explorables), never re-derived,
-- confirming the "select v.*" recreation in this same migration actually
-- picked up the new trailing column in each downstream view.
do $$
declare
  v_visibles int;
  v_explorables int;
begin
  select vues_count into v_visibles from publications_visibles
    where id = current_setting('app.tmp_video_public')::uuid;
  select vues_count into v_explorables from publications_explorables
    where id = current_setting('app.tmp_video_public')::uuid;

  if v_visibles is null or v_explorables is null then
    raise exception 'TEST FAILED: vues_count missing from publications_visibles (%) or publications_explorables (%)', v_visibles, v_explorables;
  end if;
  if v_visibles != v_explorables then
    raise exception 'TEST FAILED: vues_count disagrees between publications_visibles (%) and publications_explorables (%)', v_visibles, v_explorables;
  end if;
  raise notice 'PASS: vues_count is exposed identically through publications_visibles and publications_explorables';
end $$;

-- Grants: anon has EXECUTE on incrementer_vue_publication (the one
-- deliberate exception alongside peut_voir_publication_complete --  a
-- view count is a public, non-sensitive metric, so a logged-out visitor
-- scrolling Explorer must still be able to increment it), and both
-- publications_visibles/publications_explorables still grant SELECT to
-- anon while publications_accueil stays authenticated-only (migration
-- 0033's revoke, re-verified here since this migration recreated all
-- three views).
select set_config('app.current_user_id', '', false);
set role anon;
do $$
begin
  perform incrementer_vue_publication(current_setting('app.tmp_video_public')::uuid);
  raise notice 'PASS: anon has EXECUTE on incrementer_vue_publication';
end $$;
reset role;

do $$
begin
  if not has_function_privilege('anon', 'incrementer_vue_publication(uuid)', 'EXECUTE') then
    raise exception 'TEST FAILED: anon lacks EXECUTE on incrementer_vue_publication';
  end if;
  if not has_function_privilege('authenticated', 'incrementer_vue_publication(uuid)', 'EXECUTE') then
    raise exception 'TEST FAILED: authenticated lacks EXECUTE on incrementer_vue_publication';
  end if;
  raise notice 'PASS: has_function_privilege confirms both anon and authenticated hold EXECUTE on incrementer_vue_publication';
end $$;

do $$
begin
  if has_table_privilege('anon', 'public.publications_accueil', 'SELECT') then
    raise exception 'TEST FAILED: anon regained SELECT on publications_accueil -- migration 0043 recreated this view and must not have re-widened the 0033 revoke';
  end if;
  raise notice 'PASS: publications_accueil still has no anon SELECT after being recreated by migration 0043 (the 0033 revoke was not silently undone)';
end $$;

-- =======================================================================
-- Phase 1 of the "produit physique" offer type (migration 0039): schema,
-- atomic stock reservation, and the offres_disponibilite_produit view.
-- True concurrent-race coverage (the single most critical point of this
-- lot, per the brief) can't be exercised from this single sequential
-- psql connection -- see supabase/tests/concurrency_test_produit.sh,
-- run separately by run_sql_tests.sh, for the real multi-connection
-- proof that reserver_stock_produit's row lock prevents overselling.
-- This section covers everything reachable from one connection: the
-- rejection cases, expiry release, and the view's three states.
--
-- Fixture: créateur K (two produit offres: P1 stock=2, P2 stock=1
-- créé inactif), a don offre D1 (for the "not produit" rejection), and
-- three fans (A, B, C).
-- =======================================================================
insert into users (id) values
  ('9f000001-0000-0000-0000-000000000001'), -- créateur K
  ('9f000002-0000-0000-0000-000000000002'), -- fan A
  ('9f000003-0000-0000-0000-000000000003'), -- fan B
  ('9f000004-0000-0000-0000-000000000004'); -- fan C

insert into offres (id, createur_id, type, prix, stock_total, libelle, actif) values
  ('9f000010-0000-0000-0000-000000000010', '9f000001-0000-0000-0000-000000000001', 'produit', 15, 2, 'Produit actif', true),
  ('9f000011-0000-0000-0000-000000000011', '9f000001-0000-0000-0000-000000000001', 'produit', 15, 1, 'Produit inactif', false),
  ('9f000012-0000-0000-0000-000000000012', '9f000001-0000-0000-0000-000000000001', 'don', null, null, null, true);

-- offres_stock_coherent (the raw CHECK constraint, not the RPC's own
-- friendlier rejection) -- proven directly against the table, same
-- "prove the constraint itself" discipline as check_whatsapp_minimum_price
-- elsewhere in this file.
do $$
begin
  begin
    insert into offres (createur_id, type, prix, stock_total, libelle)
      values ('9f000001-0000-0000-0000-000000000001', 'produit', 15, null, 'Sans stock');
    raise exception 'TEST FAILED: a produit offre with stock_total=null was accepted';
  exception when check_violation then
    raise notice 'PASS: offres_stock_coherent rejects a produit offre with no stock_total';
  end;
  begin
    insert into offres (createur_id, type, prix, stock_total)
      values ('9f000001-0000-0000-0000-000000000001', 'don', null, 5);
    raise exception 'TEST FAILED: a non-produit offre with stock_total set was accepted';
  exception when check_violation then
    raise notice 'PASS: offres_stock_coherent rejects a non-produit offre with stock_total set';
  end;
end $$;

-- Rejection: no auth.uid() at all (authenticated role, no session var set).
select set_config('app.current_user_id', '', false);
set role authenticated;
do $$
begin
  begin
    perform reserver_stock_produit('9f000010-0000-0000-0000-000000000010', 1);
    raise exception 'TEST FAILED: reserver_stock_produit succeeded with a NULL auth.uid()';
  exception when others then
    if sqlerrm !~ 'not authenticated' then
      raise exception 'TEST FAILED: expected a not-authenticated error, got: %', sqlerrm;
    end if;
    raise notice 'PASS: reserver_stock_produit rejects a NULL auth.uid() caller';
  end;
end $$;
reset role;

-- Rejection: the target offre is not of type produit.
select set_config('app.current_user_id', '9f000002-0000-0000-0000-000000000002', false);
set role authenticated;
do $$
begin
  begin
    perform reserver_stock_produit('9f000012-0000-0000-0000-000000000012', 1);
    raise exception 'TEST FAILED: reserver_stock_produit accepted a non-produit offre';
  exception when others then
    if sqlerrm !~ 'produit physique' then
      raise exception 'TEST FAILED: expected a not-a-produit error, got: %', sqlerrm;
    end if;
    raise notice 'PASS: reserver_stock_produit rejects an offre that is not type=produit';
  end;
end $$;

-- Rejection: the target offre is not actif.
do $$
begin
  begin
    perform reserver_stock_produit('9f000011-0000-0000-0000-000000000011', 1);
    raise exception 'TEST FAILED: reserver_stock_produit accepted an inactive offre';
  exception when others then
    if sqlerrm !~ 'plus disponible' then
      raise exception 'TEST FAILED: expected a not-active error, got: %', sqlerrm;
    end if;
    raise notice 'PASS: reserver_stock_produit rejects an inactive offre';
  end;
end $$;

-- Rejection: quantité demandée > disponibilité (P1 has stock_total=2).
do $$
begin
  begin
    perform reserver_stock_produit('9f000010-0000-0000-0000-000000000010', 3);
    raise exception 'TEST FAILED: reserver_stock_produit accepted a quantité exceeding stock';
  exception when others then
    if sqlerrm !~ 'stock insuffisant' then
      raise exception 'TEST FAILED: expected a stock-insuffisant error, got: %', sqlerrm;
    end if;
    raise notice 'PASS: reserver_stock_produit rejects a quantité exceeding disponibilité';
  end;
end $$;

-- None of the four rejected attempts above left any trace -- same
-- "always confirm a rejected attack/invalid call leaves no row behind"
-- discipline as every other RPC in this file. Raw-table read, so this
-- must run as the superuser (this test harness's stub_auth.sql, unlike
-- a real Supabase project, grants authenticated/anon no table-level
-- privilege at all -- see CLAUDE.md's own testing notes) -- reset role
-- before touching reservations_stock directly.
reset role;
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from reservations_stock
    where offre_id in (
      '9f000010-0000-0000-0000-000000000010',
      '9f000011-0000-0000-0000-000000000011',
      '9f000012-0000-0000-0000-000000000012'
    );
  if v_count != 0 then
    raise exception 'TEST FAILED: a rejected reserver_stock_produit call left a reservation row behind (found %)', v_count;
  end if;
  raise notice 'PASS: none of the rejected reserver_stock_produit attempts left a reservation row behind';
end $$;

-- A real, successful reservation: fan A reserves 1 of P1's 2 units.
-- disponible_maintenant drops immediately; disponible_definitif does not
-- (a hold is not yet a sale).
select reserver_stock_produit('9f000010-0000-0000-0000-000000000010', 1);

do $$
declare
  v_disponible record;
begin
  select disponible_maintenant, disponible_definitif into v_disponible
    from offres_disponibilite_produit where offre_id = '9f000010-0000-0000-0000-000000000010';
  if v_disponible.disponible_maintenant != 1 then
    raise exception 'TEST FAILED: expected disponible_maintenant=1 after a 1-unit hold on 2 stock, got %', v_disponible.disponible_maintenant;
  end if;
  if v_disponible.disponible_definitif != 2 then
    raise exception 'TEST FAILED: an unconfirmed hold should not reduce disponible_definitif, got %', v_disponible.disponible_definitif;
  end if;
  raise notice 'PASS: a fresh unconfirmed reservation reduces disponible_maintenant only, never disponible_definitif';
end $$;
reset role;

-- Fan B tries to reserve 2 (only 1 left) -- rejected. Then reserves
-- exactly the 1 remaining unit -- succeeds, bringing disponible_maintenant
-- to 0 while both holds are still unconfirmed (the "réservé temporairement
-- par un tiers" state, exercised more directly below via a dedicated
-- three-offre fixture).
select set_config('app.current_user_id', '9f000003-0000-0000-0000-000000000003', false);
set role authenticated;
do $$
begin
  begin
    perform reserver_stock_produit('9f000010-0000-0000-0000-000000000010', 2);
    raise exception 'TEST FAILED: reserver_stock_produit accepted 2 when only 1 unit remained';
  exception when others then
    if sqlerrm !~ 'stock insuffisant' then
      raise exception 'TEST FAILED: expected a stock-insuffisant error, got: %', sqlerrm;
    end if;
    raise notice 'PASS: reserver_stock_produit rejects a request exceeding the real remaining stock (accounting for another fan''s active hold)';
  end;
end $$;
select reserver_stock_produit('9f000010-0000-0000-0000-000000000010', 1);
reset role;

-- Expiry release: backdate fan A's hold (the only way to simulate the
-- 10-minute window having passed, same "disable/backdate directly, the
-- trigger/logic can't be fooled into doing it itself" pattern as the
-- pseudo-cooldown test elsewhere in this file) and confirm the freed unit
-- can be reserved again by a third fan.
update reservations_stock set expire_at = now() - interval '1 minute'
  where offre_id = '9f000010-0000-0000-0000-000000000010' and fan_id = '9f000002-0000-0000-0000-000000000002';

do $$
declare
  v_disponible integer;
begin
  select disponible_maintenant into v_disponible
    from offres_disponibilite_produit where offre_id = '9f000010-0000-0000-0000-000000000010';
  if v_disponible != 1 then
    raise exception 'TEST FAILED: an expired hold should free its stock back up, expected disponible_maintenant=1, got %', v_disponible;
  end if;
  raise notice 'PASS: an expired, unconfirmed reservation no longer counts against disponible_maintenant';
end $$;

select set_config('app.current_user_id', '9f000004-0000-0000-0000-000000000004', false);
set role authenticated;
select reserver_stock_produit('9f000010-0000-0000-0000-000000000010', 1);
reset role;

do $$
declare
  v_disponible integer;
begin
  select disponible_maintenant into v_disponible
    from offres_disponibilite_produit where offre_id = '9f000010-0000-0000-0000-000000000010';
  if v_disponible != 0 then
    raise exception 'TEST FAILED: expected disponible_maintenant=0 once the freed unit was re-reserved, got %', v_disponible;
  end if;
  raise notice 'PASS: a new reservation can succeed on stock freed by an earlier reservation''s expiry';
end $$;

-- prochaine_liberation never leaks the reservataire's identity -- only
-- the timing. Checked two ways: the view's own column list (no fan_id at
-- all, information_schema-level) and, positively, that the column IS
-- populated with a real, upcoming timestamp for an offre with an active
-- unconfirmed hold.
do $$
declare
  v_columns text;
begin
  select string_agg(column_name, ',') into v_columns
    from information_schema.columns
    where table_schema = 'public' and table_name = 'offres_disponibilite_produit';
  if v_columns ~ 'fan' then
    raise exception 'TEST FAILED: offres_disponibilite_produit exposes a fan-identifying column (%)', v_columns;
  end if;
  raise notice 'PASS: offres_disponibilite_produit exposes no fan-identifying column (%)', v_columns;
end $$;

do $$
declare
  v_prochaine timestamptz;
begin
  select prochaine_liberation into v_prochaine
    from offres_disponibilite_produit where offre_id = '9f000010-0000-0000-0000-000000000010';
  if v_prochaine is null or v_prochaine <= now() then
    raise exception 'TEST FAILED: expected a real, upcoming prochaine_liberation for an offre with an active hold, got %', v_prochaine;
  end if;
  raise notice 'PASS: prochaine_liberation reflects the nearest active hold''s expiry, with no reservataire identity exposed';
end $$;

-- ---------------------------------------------------------------------
-- The view's three distinct states, per the brief -- a dedicated,
-- clean fixture per state (créateur K2) so each assertion is
-- unambiguous rather than reasoning about a fixture shared with the
-- rejection tests above.
-- ---------------------------------------------------------------------
insert into users (id) values ('9f000005-0000-0000-0000-000000000005'); -- créateur K2

insert into offres (id, createur_id, type, prix, stock_total, libelle) values
  ('9f000020-0000-0000-0000-000000000020', '9f000005-0000-0000-0000-000000000005', 'produit', 20, 3, 'En stock'),
  ('9f000021-0000-0000-0000-000000000021', '9f000005-0000-0000-0000-000000000005', 'produit', 20, 1, 'Reserve tiers'),
  ('9f000022-0000-0000-0000-000000000022', '9f000005-0000-0000-0000-000000000005', 'produit', 20, 1, 'Epuise');

-- State 1: "en stock" -- untouched, disponible_maintenant = disponible_definitif = stock_total.
do $$
declare
  v_disponible record;
begin
  select disponible_maintenant, disponible_definitif into v_disponible
    from offres_disponibilite_produit where offre_id = '9f000020-0000-0000-0000-000000000020';
  if v_disponible.disponible_maintenant != 3 or v_disponible.disponible_definitif != 3 then
    raise exception 'TEST FAILED: expected a fresh produit offre fully in stock (3/3), got %/%', v_disponible.disponible_maintenant, v_disponible.disponible_definitif;
  end if;
  raise notice 'PASS: offres_disponibilite_produit reports "en stock" correctly for an untouched offre';
end $$;

-- State 2: "réservé temporairement par un tiers" -- disponible_maintenant
-- insufficient for a new caller, but disponible_definitif still > 0
-- (nobody has actually bought it yet).
select set_config('app.current_user_id', '9f000002-0000-0000-0000-000000000002', false);
set role authenticated;
select reserver_stock_produit('9f000021-0000-0000-0000-000000000021', 1);
reset role;

do $$
declare
  v_disponible record;
begin
  select disponible_maintenant, disponible_definitif into v_disponible
    from offres_disponibilite_produit where offre_id = '9f000021-0000-0000-0000-000000000021';
  if v_disponible.disponible_maintenant != 0 then
    raise exception 'TEST FAILED: expected disponible_maintenant=0 while held by another fan, got %', v_disponible.disponible_maintenant;
  end if;
  if v_disponible.disponible_definitif != 1 then
    raise exception 'TEST FAILED: an unconfirmed hold must not reduce disponible_definitif, expected 1, got %', v_disponible.disponible_definitif;
  end if;
  raise notice 'PASS: offres_disponibilite_produit reports "réservé temporairement par un tiers" correctly (disponible_maintenant=0, disponible_definitif=1)';
end $$;

-- State 3: "épuisé pour de bon" -- a CONFIRMED sale (transaction_id set,
-- simulating what the webhook does) permanently reduces
-- disponible_definitif to 0.
select set_config('app.current_user_id', '9f000003-0000-0000-0000-000000000003', false);
set role authenticated;
do $$
declare
  v_id uuid;
begin
  select reservation_id into v_id from reserver_stock_produit('9f000022-0000-0000-0000-000000000022', 1);
  perform set_config('app.tmp_reservation_epuise', v_id::text, false);
end $$;
reset role;

insert into transactions (id, fan_id, createur_id, offre_id, montant, quantite) values
  ('9f000030-0000-0000-0000-000000000030', '9f000003-0000-0000-0000-000000000003', '9f000005-0000-0000-0000-000000000005', '9f000022-0000-0000-0000-000000000022', 20, 1);

update reservations_stock set transaction_id = '9f000030-0000-0000-0000-000000000030'
  where id = current_setting('app.tmp_reservation_epuise')::uuid;

do $$
declare
  v_disponible record;
begin
  select disponible_maintenant, disponible_definitif into v_disponible
    from offres_disponibilite_produit where offre_id = '9f000022-0000-0000-0000-000000000022';
  if v_disponible.disponible_definitif != 0 then
    raise exception 'TEST FAILED: expected disponible_definitif=0 once the only unit is confirmed sold, got %', v_disponible.disponible_definitif;
  end if;
  if v_disponible.disponible_maintenant != 0 then
    raise exception 'TEST FAILED: expected disponible_maintenant=0 for a sold-out offre, got %', v_disponible.disponible_maintenant;
  end if;
  raise notice 'PASS: offres_disponibilite_produit reports "épuisé pour de bon" correctly (disponible_definitif=0)';
end $$;

-- A confirmed sale's prochaine_liberation is null -- there is no active,
-- unconfirmed hold left to eventually free anything up.
do $$
declare
  v_prochaine timestamptz;
begin
  select prochaine_liberation into v_prochaine
    from offres_disponibilite_produit where offre_id = '9f000022-0000-0000-0000-000000000022';
  if v_prochaine is not null then
    raise exception 'TEST FAILED: expected a null prochaine_liberation for a fully sold-out offre with no pending hold, got %', v_prochaine;
  end if;
  raise notice 'PASS: prochaine_liberation is null once every unit is either confirmed sold or has no active hold';
end $$;

-- Grants: reserver_stock_produit is authenticated-only (reserving stock
-- requires a real account); offres_disponibilite_produit is a plain
-- public view like offres_publiques/campagnes_publiques, open to anon.
select set_config('app.current_user_id', '', false);
set role anon;
do $$
begin
  begin
    perform reserver_stock_produit('9f000020-0000-0000-0000-000000000020', 1);
    raise exception 'TEST FAILED: anon was able to call reserver_stock_produit';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no EXECUTE on reserver_stock_produit (real Postgres permission error)';
  end;
end $$;

do $$
begin
  perform 1 from public.offres_disponibilite_produit limit 1;
  raise notice 'PASS: anon has SELECT on offres_disponibilite_produit';
end $$;
reset role;

do $$
begin
  if has_function_privilege('anon', 'reserver_stock_produit(uuid,integer)', 'EXECUTE') then
    raise exception 'TEST FAILED: anon holds EXECUTE on reserver_stock_produit';
  end if;
  raise notice 'PASS: has_function_privilege confirms anon lacks EXECUTE on reserver_stock_produit';
end $$;

do $$
begin
  if not has_function_privilege('authenticated', 'reserver_stock_produit(uuid,integer)', 'EXECUTE') then
    raise exception 'TEST FAILED: authenticated lacks EXECUTE on reserver_stock_produit';
  end if;
  raise notice 'PASS: has_function_privilege confirms authenticated holds EXECUTE on reserver_stock_produit';
end $$;

do $$
begin
  if not has_table_privilege('anon', 'public.offres_disponibilite_produit', 'SELECT') then
    raise exception 'TEST FAILED: anon lacks SELECT on offres_disponibilite_produit';
  end if;
  if not has_table_privilege('authenticated', 'public.offres_disponibilite_produit', 'SELECT') then
    raise exception 'TEST FAILED: authenticated lacks SELECT on offres_disponibilite_produit';
  end if;
  raise notice 'PASS: has_table_privilege confirms both anon and authenticated hold SELECT on offres_disponibilite_produit';
end $$;

-- =======================================================================
-- Phase 2 of the "produit physique" offer type (migration 0040):
-- livrer_produit() -- the créateur-facing "mark as shipped" RPC, opening
-- the same 72h fan-confirmation escrow window deliver_video() does.
--
-- Fixture: créateur K (a produit offre and a video offre), fan A, and an
-- unrelated authenticated user U (proves ownership is actually checked,
-- not just "some session exists"). Three transactions: a produit one at
-- validee (the happy path), a video one at validee (proves the
-- type=produit guard), and a produit one still at en_attente (proves the
-- "must have reached validee" guard) -- deliberately inserted directly at
-- en_attente to simulate the moment right after the webhook creates a
-- brand-new produit transaction, before it moves to validee.
-- =======================================================================
insert into users (id) values
  ('af000001-0000-0000-0000-000000000001'), -- créateur K
  ('af000002-0000-0000-0000-000000000002'), -- fan A
  ('af000003-0000-0000-0000-000000000003'); -- unrelated authenticated user U

insert into offres (id, createur_id, type, prix, stock_total, libelle) values
  ('af000010-0000-0000-0000-000000000010', 'af000001-0000-0000-0000-000000000001', 'produit', 20, 5, 'T-shirt'),
  ('af000011-0000-0000-0000-000000000011', 'af000001-0000-0000-0000-000000000001', 'video', 20, null, null);

insert into transactions (id, fan_id, createur_id, offre_id, montant, statut, quantite, adresse_livraison) values
  ('af000020-0000-0000-0000-000000000020', 'af000002-0000-0000-0000-000000000002', 'af000001-0000-0000-0000-000000000001', 'af000010-0000-0000-0000-000000000010', 20, 'validee', 1, '12 avenue de la Paix, Kinshasa'),
  ('af000021-0000-0000-0000-000000000021', 'af000002-0000-0000-0000-000000000002', 'af000001-0000-0000-0000-000000000001', 'af000011-0000-0000-0000-000000000011', 20, 'validee', 1, null),
  ('af000022-0000-0000-0000-000000000022', 'af000002-0000-0000-0000-000000000002', 'af000001-0000-0000-0000-000000000001', 'af000010-0000-0000-0000-000000000010', 20, 'en_attente', 1, null);

-- Rejection: no auth.uid() at all.
select set_config('app.current_user_id', '', false);
set role authenticated;
do $$
begin
  begin
    perform livrer_produit('af000020-0000-0000-0000-000000000020');
    raise exception 'TEST FAILED: livrer_produit succeeded with a NULL auth.uid()';
  exception when others then
    if sqlerrm !~ 'not authenticated' then
      raise exception 'TEST FAILED: expected a not-authenticated error, got: %', sqlerrm;
    end if;
    raise notice 'PASS: livrer_produit rejects a NULL auth.uid() caller';
  end;
end $$;
reset role;

-- Rejection: the target transaction's offre is not type=produit (video).
select set_config('app.current_user_id', 'af000001-0000-0000-0000-000000000001', false);
set role authenticated;
do $$
begin
  begin
    perform livrer_produit('af000021-0000-0000-0000-000000000021');
    raise exception 'TEST FAILED: livrer_produit accepted a video transaction';
  exception when others then
    if sqlerrm !~ 'produit' then
      raise exception 'TEST FAILED: expected a not-a-produit error, got: %', sqlerrm;
    end if;
    raise notice 'PASS: livrer_produit rejects a non-produit (video) transaction -- the exact inverse of deliver_video()''s own video/shoutout-only guard';
  end;
end $$;
reset role;

-- Rejection: a genuinely different authenticated user (not the créateur
-- who owns this transaction) is not authorized.
select set_config('app.current_user_id', 'af000003-0000-0000-0000-000000000003', false);
set role authenticated;
do $$
begin
  begin
    perform livrer_produit('af000020-0000-0000-0000-000000000020');
    raise exception 'TEST FAILED: livrer_produit accepted a non-owner caller';
  exception when others then
    if sqlerrm !~ 'not authorized' then
      raise exception 'TEST FAILED: expected a not-authorized error, got: %', sqlerrm;
    end if;
    raise notice 'PASS: livrer_produit rejects a caller who does not own the transaction';
  end;
end $$;
reset role;

-- Rejection: the transaction has not reached validee yet (still
-- en_attente -- simulating the instant right after the webhook creates a
-- brand-new produit transaction, before its own validee update lands).
select set_config('app.current_user_id', 'af000001-0000-0000-0000-000000000001', false);
set role authenticated;
do $$
begin
  begin
    perform livrer_produit('af000022-0000-0000-0000-000000000022');
    raise exception 'TEST FAILED: livrer_produit accepted a transaction still at en_attente';
  exception when others then
    if sqlerrm !~ 'validee' then
      raise exception 'TEST FAILED: expected a not-yet-validee error, got: %', sqlerrm;
    end if;
    raise notice 'PASS: livrer_produit rejects a transaction that has not reached validee -- deliberately NOT requiring a separate acceptation step first (see CLAUDE.md), just that a real payment landed';
  end;
end $$;
reset role;

-- None of the four rejected attempts above touched any of the three
-- fixture transactions -- same "always confirm a rejected attempt leaves
-- no trace" discipline as every other RPC in this file.
do $$
declare
  v_statut text;
  v_confirmation text;
begin
  select statut, confirmation_fan into v_statut, v_confirmation
    from transactions where id = 'af000020-0000-0000-0000-000000000020';
  if v_statut != 'validee' or v_confirmation != 'non_applicable' then
    raise exception 'TEST FAILED: the happy-path fixture transaction was mutated by a rejected attempt (statut=%, confirmation_fan=%)', v_statut, v_confirmation;
  end if;
  raise notice 'PASS: none of the rejected livrer_produit attempts left any trace on the fixture transactions';
end $$;

-- The genuine success path: statut -> livree, livrable carries the
-- reference_suivi, and the same 72h escrow window deliver_video() opens
-- (confirmation_fan='en_attente', deadline_confirmation ~72h out).
select set_config('app.current_user_id', 'af000001-0000-0000-0000-000000000001', false);
set role authenticated;
select livrer_produit('af000020-0000-0000-0000-000000000020', 'DHL-CD-98765');
reset role;

do $$
declare
  v_tx record;
begin
  select statut, livrable, confirmation_fan, deadline_confirmation into v_tx
    from transactions where id = 'af000020-0000-0000-0000-000000000020';

  if v_tx.statut != 'livree' then
    raise exception 'TEST FAILED: expected statut=livree after livrer_produit, got %', v_tx.statut;
  end if;
  if v_tx.livrable->>'reference_suivi' != 'DHL-CD-98765' then
    raise exception 'TEST FAILED: expected livrable.reference_suivi=DHL-CD-98765, got %', v_tx.livrable;
  end if;
  if v_tx.confirmation_fan != 'en_attente' then
    raise exception 'TEST FAILED: expected confirmation_fan=en_attente (escrow opened), got %', v_tx.confirmation_fan;
  end if;
  if v_tx.deadline_confirmation is null
     or v_tx.deadline_confirmation < now() + interval '71 hours'
     or v_tx.deadline_confirmation > now() + interval '73 hours' then
    raise exception 'TEST FAILED: expected deadline_confirmation ~72h out, got %', v_tx.deadline_confirmation;
  end if;
  raise notice 'PASS: livrer_produit marks the order livree, records the tracking reference, and opens the same 72h fan-confirmation escrow window as deliver_video()';
end $$;

-- reference_suivi is genuinely optional -- a second produit order shipped
-- with no reference at all still succeeds, with a null reference_suivi
-- recorded (not an empty string, not a missing key crash). Reset directly
-- as the superuser (no direct-table UPDATE policy exists for
-- authenticated on transactions -- every state change goes through a
-- vetted RPC, which is exactly the mechanism under test here).
update transactions set statut = 'validee'
  where id = 'af000022-0000-0000-0000-000000000022';

select set_config('app.current_user_id', 'af000001-0000-0000-0000-000000000001', false);
set role authenticated;
select livrer_produit('af000022-0000-0000-0000-000000000022');
reset role;

do $$
declare
  v_reference jsonb;
begin
  select livrable into v_reference from transactions where id = 'af000022-0000-0000-0000-000000000022';
  if v_reference->'reference_suivi' is distinct from 'null'::jsonb then
    raise exception 'TEST FAILED: expected a JSON null reference_suivi when none was given, got %', v_reference;
  end if;
  raise notice 'PASS: livrer_produit works with no reference_suivi at all (genuinely optional)';
end $$;

-- Grants: same authenticated-only discipline as every write RPC since
-- migration 0020 (reserver_stock_produit's own grant test, above, is the
-- most recent precedent).
select set_config('app.current_user_id', '', false);
set role anon;
do $$
begin
  begin
    perform livrer_produit('af000020-0000-0000-0000-000000000020');
    raise exception 'TEST FAILED: anon was able to call livrer_produit';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no EXECUTE on livrer_produit (real Postgres permission error)';
  end;
end $$;
reset role;

do $$
begin
  if has_function_privilege('anon', 'livrer_produit(uuid,text)', 'EXECUTE') then
    raise exception 'TEST FAILED: anon holds EXECUTE on livrer_produit';
  end if;
  raise notice 'PASS: has_function_privilege confirms anon lacks EXECUTE on livrer_produit';
end $$;

do $$
begin
  if not has_function_privilege('authenticated', 'livrer_produit(uuid,text)', 'EXECUTE') then
    raise exception 'TEST FAILED: authenticated lacks EXECUTE on livrer_produit';
  end if;
  raise notice 'PASS: has_function_privilege confirms authenticated holds EXECUTE on livrer_produit';
end $$;

-- =======================================================================
-- Publications: image/video-only publications (migration 0044). Real,
-- confirmed bug: a créateur could never publish a photo or video with no
-- caption at all -- publications_contenu_coherent (migration 0031)
-- unconditionally required 1-2000 chars of contenu for any non-repost
-- row, and publier_message() enforced the identical all-or-nothing rule
-- on top. New rule: a plain (non-repost) publication needs at least one
-- of contenu/image_r2_key/video_r2_key, not contenu specifically.
--
-- Fixture: créateur L (verified).
-- =======================================================================
insert into users (id, createur_verifie, est_admin) values
  ('b0440001-0000-0000-0000-000000000001', true, false);

-- Raw constraint level first, same "prove the constraint itself, not
-- just an RPC's refusal to attempt it" discipline as
-- publications_media_exclusif above: an image-only and a video-only row
-- (superuser, bypassing publier_message() entirely) must now succeed,
-- and a row with neither text nor media must still be rejected.
do $$
begin
  insert into publications (auteur_id, type, contenu, image_r2_key, visibilite)
    values ('b0440001-0000-0000-0000-000000000001', 'createur', null,
            'publications/b0440001/image-only.jpg', 'public');
  raise notice 'PASS: publications_contenu_coherent accepts a raw image-only row (contenu null)';
exception when check_violation then
  raise exception 'TEST FAILED: publications_contenu_coherent rejected a valid image-only row';
end $$;

do $$
begin
  insert into publications (auteur_id, type, contenu, video_r2_key, visibilite)
    values ('b0440001-0000-0000-0000-000000000001', 'createur', null,
            'publications/b0440001/video-only.mp4', 'public');
  raise notice 'PASS: publications_contenu_coherent accepts a raw video-only row (contenu null)';
exception when check_violation then
  raise exception 'TEST FAILED: publications_contenu_coherent rejected a valid video-only row';
end $$;

do $$
begin
  begin
    insert into publications (auteur_id, type, contenu, visibilite)
      values ('b0440001-0000-0000-0000-000000000001', 'createur', null, 'public');
    raise exception 'TEST FAILED: publications_contenu_coherent accepted a row with no contenu and no media at all';
  exception when check_violation then
    raise notice 'PASS: publications_contenu_coherent still rejects a plain post with neither text nor media';
  end;
end $$;

-- Repost shape is untouched: repost_de_id set + contenu null still
-- required, exactly as migration 0031 defined it -- a repost row can
-- never carry contenu even though a plain post's own rule just loosened.
do $$
declare
  v_original_id uuid;
begin
  select id into v_original_id from publications
    where auteur_id = 'b0440001-0000-0000-0000-000000000001'
      and image_r2_key = 'publications/b0440001/image-only.jpg';

  begin
    insert into publications (auteur_id, type, contenu, repost_de_id, visibilite)
      values ('b0440001-0000-0000-0000-000000000001', 'createur', 'not allowed on a repost',
              v_original_id, 'public');
    raise exception 'TEST FAILED: publications_contenu_coherent accepted a repost row with non-null contenu';
  exception when check_violation then
    raise notice 'PASS: publications_contenu_coherent still requires contenu is null for a repost row, unchanged';
  end;
end $$;

-- publier_message() itself: image-only and video-only calls (p_contenu
-- omitted entirely, relying on its new default null) must now succeed,
-- and a call with no contenu/image/video at all must still be rejected
-- with a clear error, never silently.
select set_config('app.current_user_id', 'b0440001-0000-0000-0000-000000000001', false);
set role authenticated;
select publier_message(p_image_r2_key := 'publications/b0440001/rpc-image-only.jpg');
select publier_message(p_video_r2_key := 'publications/b0440001/rpc-video-only.mp4');
reset role;

do $$
declare
  v_id uuid;
  v_contenu text;
begin
  select id, contenu into v_id, v_contenu from publications
    where image_r2_key = 'publications/b0440001/rpc-image-only.jpg';
  if v_id is null then
    raise exception 'TEST FAILED: publier_message() did not create the image-only publication';
  end if;
  if v_contenu is not null then
    raise exception 'TEST FAILED: expected a null contenu on an image-only publication, got %', v_contenu;
  end if;
  raise notice 'PASS: publier_message() accepts an image-only publication with contenu omitted';
end $$;

do $$
declare
  v_id uuid;
begin
  select id into v_id from publications
    where video_r2_key = 'publications/b0440001/rpc-video-only.mp4';
  if v_id is null then
    raise exception 'TEST FAILED: publier_message() did not create the video-only publication';
  end if;
  raise notice 'PASS: publier_message() accepts a video-only publication with contenu omitted';
end $$;

select set_config('app.current_user_id', 'b0440001-0000-0000-0000-000000000001', false);
set role authenticated;
do $$
begin
  begin
    perform publier_message();
    raise exception 'TEST FAILED: publier_message() accepted a call with no contenu, image, or video at all';
  exception when others then
    if sqlerrm not like '%contenu, image_r2_key ou video_r2_key requis%' then
      raise exception 'TEST FAILED: unexpected error for a fully empty publier_message() call: %', sqlerrm;
    end if;
    raise notice 'PASS: publier_message() still rejects a call with no text and no media at all';
  end;
end $$;
reset role;

-- A whitespace-only p_contenu with no media is still exactly the empty
-- case -- normalized to null before the presence check, not treated as
-- "has text".
select set_config('app.current_user_id', 'b0440001-0000-0000-0000-000000000001', false);
set role authenticated;
do $$
begin
  begin
    perform publier_message(p_contenu := '   ');
    raise exception 'TEST FAILED: publier_message() accepted whitespace-only contenu with no media';
  exception when others then
    if sqlerrm not like '%contenu, image_r2_key ou video_r2_key requis%' then
      raise exception 'TEST FAILED: unexpected error for a whitespace-only publier_message() call: %', sqlerrm;
    end if;
    raise notice 'PASS: publier_message() treats whitespace-only contenu as empty, still rejected without media';
  end;
end $$;
reset role;

-- ---------------------------------------------------------------------
-- Concours entre créateurs, Phase 1 (migration 0045): creer_concours()/
-- inviter_participant_concours()/accepter_invitation_concours()/
-- refuser_invitation_concours(), concours_publics. mode is always
-- 'entre_createurs' in this lot -- there is no code path here that can
-- ever produce 'maitre_du_jeu' (Phase 2, not built).
--
-- Fixture: organisateur (c0450001), participant B (c0450002, invited
-- then accepts), participant C (c0450003, invited then refuses),
-- participant D (c0450004, invited and left pending forever -- proves
-- an unresolved invitation never leaks either), a stranger créateur
-- (c0450006) with their own unrelated campagne (used to prove
-- inviter_participant_concours() can't be tricked into linking someone
-- else's campaign to a different invitee, and never invited to the main
-- concours themselves), and a fan (c0450005) to fund contributions for
-- the montant_collecte/winner tests.
-- ---------------------------------------------------------------------
insert into users (id, telephone, pays) values
  ('c0450001-0000-0000-0000-000000000001', '+243900000301', 'RDC'),
  ('c0450002-0000-0000-0000-000000000002', '+243900000302', 'RDC'),
  ('c0450003-0000-0000-0000-000000000003', '+243900000303', 'RDC'),
  ('c0450004-0000-0000-0000-000000000004', '+243900000304', 'RDC'),
  ('c0450005-0000-0000-0000-000000000005', '+243900000305', 'RDC'),
  ('c0450006-0000-0000-0000-000000000006', '+243900000306', 'RDC');

insert into offres (id, createur_id, type, libelle, config, actif) values
  ('c0451001-0000-0000-0000-000000000001', 'c0450001-0000-0000-0000-000000000001', 'campagne', 'Campagne organisateur', jsonb_build_object('description', 'x', 'objectif', 1000), true),
  ('c0451002-0000-0000-0000-000000000002', 'c0450002-0000-0000-0000-000000000002', 'campagne', 'Campagne B', jsonb_build_object('description', 'x', 'objectif', 1000), true),
  ('c0451003-0000-0000-0000-000000000003', 'c0450003-0000-0000-0000-000000000003', 'campagne', 'Campagne C', jsonb_build_object('description', 'x', 'objectif', 1000), true),
  ('c0451004-0000-0000-0000-000000000004', 'c0450004-0000-0000-0000-000000000004', 'campagne', 'Campagne D', jsonb_build_object('description', 'x', 'objectif', 1000), true),
  ('c0451006-0000-0000-0000-000000000006', 'c0450006-0000-0000-0000-000000000006', 'campagne', 'Campagne étrangère', jsonb_build_object('description', 'x', 'objectif', 1000), true),
  -- Non-campagne offre -- proves creer_concours() rejects a p_campagne_id that isn't type='campagne'.
  ('c0451009-0000-0000-0000-000000000009', 'c0450001-0000-0000-0000-000000000001', 'don', null, '{}', true);

-- creer_concours() rejects a p_campagne_id that isn't a campagne offre.
select set_config('app.current_user_id', 'c0450001-0000-0000-0000-000000000001', false);
set role authenticated;
do $$
begin
  begin
    perform creer_concours('Mauvais type', now() + interval '10 days', 'c0451009-0000-0000-0000-000000000009');
    raise exception 'TEST FAILED: creer_concours() accepted a non-campagne offre';
  exception when others then
    if sqlerrm != 'not authorized: p_campagne_id must reference a campagne offre' then
      raise exception 'TEST FAILED: unexpected error for a non-campagne p_campagne_id: %', sqlerrm;
    end if;
    raise notice 'PASS: creer_concours() rejects a p_campagne_id that is not a campagne offre';
  end;
end $$;
reset role;

-- creer_concours() rejects a campagne that doesn't belong to the caller.
select set_config('app.current_user_id', 'c0450002-0000-0000-0000-000000000002', false);
set role authenticated;
do $$
begin
  begin
    perform creer_concours('Pas ma campagne', now() + interval '10 days', 'c0451001-0000-0000-0000-000000000001');
    raise exception 'TEST FAILED: creer_concours() accepted another créateur''s campaign';
  exception when others then
    if sqlerrm != 'not authorized: you can only use your own campaign' then
      raise exception 'TEST FAILED: unexpected error for creer_concours() ownership violation: %', sqlerrm;
    end if;
    raise notice 'PASS: creer_concours() rejects a campagne that does not belong to the caller';
  end;
end $$;
reset role;

-- Real creation: the organisateur becomes an already-accepted participant
-- in the same call. Stashed via set_config -- concours.id is
-- gen_random_uuid()-generated, unknown in advance, same "capture as the
-- issuing role, read back via current_setting() inside any later
-- role-switched block" pattern already established for Lot 5b's report
-- ids (this stub harness has no table-level grant for authenticated/anon
-- to just SELECT the id back out of `concours` directly, and psql
-- variable interpolation doesn't reach inside a dollar-quoted DO body
-- either).
select set_config('app.current_user_id', 'c0450001-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config(
  'app.concours_duo_id',
  (select creer_concours('Concours Duo', now() + interval '10 days', 'c0451001-0000-0000-0000-000000000001'))::text,
  false
);
reset role;

do $$
declare
  v_count integer;
  v_statut text;
  v_mode text;
begin
  select count(*) into v_count from concours_participants
    where concours_id = current_setting('app.concours_duo_id')::uuid;
  if v_count != 1 then
    raise exception 'TEST FAILED: creer_concours() should have inserted exactly 1 participant row, got %', v_count;
  end if;

  select invite_statut into v_statut from concours_participants
    where concours_id = current_setting('app.concours_duo_id')::uuid
      and createur_id = 'c0450001-0000-0000-0000-000000000001';
  if v_statut != 'accepte' then
    raise exception 'TEST FAILED: the organisateur should be auto-accepted, got statut=%', v_statut;
  end if;

  select mode into v_mode from concours where id = current_setting('app.concours_duo_id')::uuid;
  if v_mode != 'entre_createurs' then
    raise exception 'TEST FAILED: creer_concours() should always produce mode=entre_createurs, got %', v_mode;
  end if;

  raise notice 'PASS: creer_concours() creates the concours and auto-accepts the organisateur as its first participant, mode=entre_createurs';
end $$;

-- inviter_participant_concours(): organizer tries to link the STRANGER's
-- campagne to a different invitee (participant B) -- must be rejected.
-- This is the exact hole the brief calls out explicitly: without this
-- check, the organizer could attribute someone else's collected total to
-- the wrong participant.
select set_config('app.current_user_id', 'c0450001-0000-0000-0000-000000000001', false);
set role authenticated;
do $$
begin
  begin
    perform inviter_participant_concours(
      current_setting('app.concours_duo_id')::uuid,
      'c0450002-0000-0000-0000-000000000002',
      'c0451006-0000-0000-0000-000000000006'
    );
    raise exception 'TEST FAILED: inviter_participant_concours() linked a campagne not owned by the invited créateur';
  exception when others then
    if sqlerrm != 'not authorized: this campaign does not belong to the invited créateur' then
      raise exception 'TEST FAILED: unexpected error for the campagne-ownership violation: %', sqlerrm;
    end if;
    raise notice 'PASS: inviter_participant_concours() rejects a p_campagne_id that does not belong to the invited créateur';
  end;
end $$;
reset role;

-- A non-organizer cannot invite anyone.
select set_config('app.current_user_id', 'c0450002-0000-0000-0000-000000000002', false);
set role authenticated;
do $$
begin
  begin
    perform inviter_participant_concours(
      current_setting('app.concours_duo_id')::uuid,
      'c0450003-0000-0000-0000-000000000003',
      'c0451003-0000-0000-0000-000000000003'
    );
    raise exception 'TEST FAILED: a non-organizer was able to invite a participant';
  exception when others then
    if sqlerrm != 'not authorized: only the concours organizer can invite participants' then
      raise exception 'TEST FAILED: unexpected error for the non-organizer invite attempt: %', sqlerrm;
    end if;
    raise notice 'PASS: inviter_participant_concours() rejects a caller who is not the concours organizer';
  end;
end $$;
reset role;

-- Real invites: B, C, D, each with their own real campagne.
select set_config('app.current_user_id', 'c0450001-0000-0000-0000-000000000001', false);
set role authenticated;
select inviter_participant_concours(current_setting('app.concours_duo_id')::uuid, 'c0450002-0000-0000-0000-000000000002', 'c0451002-0000-0000-0000-000000000002');
select inviter_participant_concours(current_setting('app.concours_duo_id')::uuid, 'c0450003-0000-0000-0000-000000000003', 'c0451003-0000-0000-0000-000000000003');
select inviter_participant_concours(current_setting('app.concours_duo_id')::uuid, 'c0450004-0000-0000-0000-000000000004', 'c0451004-0000-0000-0000-000000000004');
reset role;

-- accepter_invitation_concours()/refuser_invitation_concours() only ever
-- act on the CALLER's own row (no target-createur parameter exists at
-- all) -- so "can't act on someone else's invitation" is structural, not
-- merely checked. What's actually testable: a caller with no invitation
-- at all for this concours gets a clear "invitation not found", not a
-- silent no-op or someone else's row being touched.
select set_config('app.current_user_id', 'c0450005-0000-0000-0000-000000000005', false);
set role authenticated;
do $$
begin
  begin
    perform accepter_invitation_concours(current_setting('app.concours_duo_id')::uuid);
    raise exception 'TEST FAILED: accepter_invitation_concours() succeeded for a créateur who was never invited';
  exception when others then
    if sqlerrm != 'invitation not found' then
      raise exception 'TEST FAILED: unexpected error for a non-existent invitation: %', sqlerrm;
    end if;
    raise notice 'PASS: accepter_invitation_concours() rejects a caller with no invitation at all ("invitation not found")';
  end;
end $$;
reset role;

-- Participant B accepts their own real invitation.
select set_config('app.current_user_id', 'c0450002-0000-0000-0000-000000000002', false);
set role authenticated;
select accepter_invitation_concours(current_setting('app.concours_duo_id')::uuid);
reset role;

-- A second accept attempt on the same, already-resolved invitation is
-- rejected, not silently re-applied.
select set_config('app.current_user_id', 'c0450002-0000-0000-0000-000000000002', false);
set role authenticated;
do $$
begin
  begin
    perform accepter_invitation_concours(current_setting('app.concours_duo_id')::uuid);
    raise exception 'TEST FAILED: accepter_invitation_concours() re-applied on an already-accepted invitation';
  exception when others then
    if sqlerrm != 'invitation already resolved' then
      raise exception 'TEST FAILED: unexpected error re-accepting an already-resolved invitation: %', sqlerrm;
    end if;
    raise notice 'PASS: accepter_invitation_concours() rejects a second attempt on an already-resolved invitation';
  end;
end $$;
reset role;

-- Participant C refuses their own real invitation.
select set_config('app.current_user_id', 'c0450003-0000-0000-0000-000000000003', false);
set role authenticated;
select refuser_invitation_concours(current_setting('app.concours_duo_id')::uuid);
reset role;

-- A second refuse attempt on the same, already-resolved invitation is
-- rejected too.
select set_config('app.current_user_id', 'c0450003-0000-0000-0000-000000000003', false);
set role authenticated;
do $$
begin
  begin
    perform refuser_invitation_concours(current_setting('app.concours_duo_id')::uuid);
    raise exception 'TEST FAILED: refuser_invitation_concours() re-applied on an already-refused invitation';
  exception when others then
    if sqlerrm != 'invitation already resolved' then
      raise exception 'TEST FAILED: unexpected error re-refusing an already-resolved invitation: %', sqlerrm;
    end if;
    raise notice 'PASS: refuser_invitation_concours() rejects a second attempt on an already-resolved invitation';
  end;
end $$;
reset role;

-- Participant D's invitation is deliberately left at 'invite' forever --
-- never accepted or refused.

-- ---------------------------------------------------------------------
-- concours_publics: exactly the accepted rows, nothing else -- explicit
-- test, not assumed. Concours Duo now has: organisateur (accepte),
-- B (accepte), C (refuse), D (still invite). Only 2 rows expected.
-- ---------------------------------------------------------------------
do $$
declare
  v_count integer;
  v_has_c boolean;
  v_has_d boolean;
begin
  select count(*) into v_count from concours_publics
    where concours_id = current_setting('app.concours_duo_id')::uuid;
  if v_count != 2 then
    raise exception 'TEST FAILED: concours_publics should show exactly 2 accepted participants, got %', v_count;
  end if;

  select exists(
    select 1 from concours_publics
      where concours_id = current_setting('app.concours_duo_id')::uuid
        and createur_id = 'c0450003-0000-0000-0000-000000000003'
  ) into v_has_c;
  select exists(
    select 1 from concours_publics
      where concours_id = current_setting('app.concours_duo_id')::uuid
        and createur_id = 'c0450004-0000-0000-0000-000000000004'
  ) into v_has_d;

  if v_has_c then
    raise exception 'TEST FAILED: a REFUSED participant (C) leaked into concours_publics';
  end if;
  if v_has_d then
    raise exception 'TEST FAILED: a still-INVITED (never resolved) participant (D) leaked into concours_publics';
  end if;

  raise notice 'PASS: concours_publics shows only accepted participants -- a refused or still-pending invitation never appears';
end $$;

-- ---------------------------------------------------------------------
-- montant_collecte: never a separately-computed value, always the exact
-- same live number campagnes_montant_collecte already reports for that
-- offre_id (migration 0017) -- proven by comparing the two directly,
-- not by asserting a hardcoded number twice.
-- ---------------------------------------------------------------------
insert into transactions (id, fan_id, createur_id, offre_id, montant, statut) values
  ('c0452001-0000-0000-0000-000000000001', 'c0450005-0000-0000-0000-000000000005', 'c0450001-0000-0000-0000-000000000001', 'c0451001-0000-0000-0000-000000000001', 40, 'en_attente'),
  ('c0452002-0000-0000-0000-000000000002', 'c0450005-0000-0000-0000-000000000005', 'c0450002-0000-0000-0000-000000000002', 'c0451002-0000-0000-0000-000000000002', 25, 'en_attente');
update transactions set statut = 'validee' where id in ('c0452001-0000-0000-0000-000000000001', 'c0452002-0000-0000-0000-000000000002');
update transactions set statut = 'livree' where id in ('c0452001-0000-0000-0000-000000000001', 'c0452002-0000-0000-0000-000000000002');

do $$
declare
  v_cp_organisateur numeric;
  v_cmc_organisateur numeric;
  v_cp_b numeric;
  v_cmc_b numeric;
begin
  select montant_collecte into v_cp_organisateur from concours_publics
    where concours_id = current_setting('app.concours_duo_id')::uuid
      and createur_id = 'c0450001-0000-0000-0000-000000000001';
  select montant_collecte into v_cmc_organisateur from campagnes_montant_collecte
    where offre_id = 'c0451001-0000-0000-0000-000000000001';

  select montant_collecte into v_cp_b from concours_publics
    where concours_id = current_setting('app.concours_duo_id')::uuid
      and createur_id = 'c0450002-0000-0000-0000-000000000002';
  select montant_collecte into v_cmc_b from campagnes_montant_collecte
    where offre_id = 'c0451002-0000-0000-0000-000000000002';

  if v_cp_organisateur != v_cmc_organisateur or v_cp_organisateur != 40 then
    raise exception 'TEST FAILED: concours_publics.montant_collecte (%) diverges from campagnes_montant_collecte (%) for the organisateur', v_cp_organisateur, v_cmc_organisateur;
  end if;
  if v_cp_b != v_cmc_b or v_cp_b != 25 then
    raise exception 'TEST FAILED: concours_publics.montant_collecte (%) diverges from campagnes_montant_collecte (%) for participant B', v_cp_b, v_cmc_b;
  end if;

  raise notice 'PASS: concours_publics.montant_collecte matches campagnes_montant_collecte exactly -- never a divergent, separately-computed value';
end $$;

-- ---------------------------------------------------------------------
-- The shared screen split -- 2, 3, and an arbitrary N accepted
-- participants. The actual percentage math (1/N) is unit-tested
-- directly in src/lib/__tests__/concours.test.ts (computeEqualSharePercent);
-- what the database layer needs to prove is that concours_publics
-- reports the correct accepted-participant COUNT for the app to split
-- the screen against -- Concours Duo above already covers N=2. This
-- covers N=3 and an arbitrary N=5, reusing the same créateurs' existing
-- campagnes (nothing prevents the same campagne_id from being linked
-- into more than one concours).
-- ---------------------------------------------------------------------
select set_config('app.current_user_id', 'c0450001-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config(
  'app.concours_trio_id',
  (select creer_concours('Concours Trio', now() + interval '10 days', 'c0451001-0000-0000-0000-000000000001'))::text,
  false
);
select inviter_participant_concours(current_setting('app.concours_trio_id')::uuid, 'c0450002-0000-0000-0000-000000000002', 'c0451002-0000-0000-0000-000000000002');
select inviter_participant_concours(current_setting('app.concours_trio_id')::uuid, 'c0450003-0000-0000-0000-000000000003', 'c0451003-0000-0000-0000-000000000003');
reset role;
select set_config('app.current_user_id', 'c0450002-0000-0000-0000-000000000002', false);
set role authenticated;
select accepter_invitation_concours(current_setting('app.concours_trio_id')::uuid);
reset role;
select set_config('app.current_user_id', 'c0450003-0000-0000-0000-000000000003', false);
set role authenticated;
select accepter_invitation_concours(current_setting('app.concours_trio_id')::uuid);
reset role;

do $$
declare
  v_count integer;
begin
  select count(*) into v_count from concours_publics where concours_id = current_setting('app.concours_trio_id')::uuid;
  if v_count != 3 then
    raise exception 'TEST FAILED: Concours Trio should show exactly 3 accepted participants, got %', v_count;
  end if;
  raise notice 'PASS: concours_publics correctly reports 3 accepted participants for Concours Trio';
end $$;

select set_config('app.current_user_id', 'c0450001-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config(
  'app.concours_quintet_id',
  (select creer_concours('Concours Quintet', now() + interval '10 days', 'c0451001-0000-0000-0000-000000000001'))::text,
  false
);
select inviter_participant_concours(current_setting('app.concours_quintet_id')::uuid, 'c0450002-0000-0000-0000-000000000002', 'c0451002-0000-0000-0000-000000000002');
select inviter_participant_concours(current_setting('app.concours_quintet_id')::uuid, 'c0450003-0000-0000-0000-000000000003', 'c0451003-0000-0000-0000-000000000003');
select inviter_participant_concours(current_setting('app.concours_quintet_id')::uuid, 'c0450004-0000-0000-0000-000000000004', 'c0451004-0000-0000-0000-000000000004');
select inviter_participant_concours(current_setting('app.concours_quintet_id')::uuid, 'c0450006-0000-0000-0000-000000000006', 'c0451006-0000-0000-0000-000000000006');
reset role;
select set_config('app.current_user_id', 'c0450002-0000-0000-0000-000000000002', false);
set role authenticated;
select accepter_invitation_concours(current_setting('app.concours_quintet_id')::uuid);
reset role;
select set_config('app.current_user_id', 'c0450003-0000-0000-0000-000000000003', false);
set role authenticated;
select accepter_invitation_concours(current_setting('app.concours_quintet_id')::uuid);
reset role;
select set_config('app.current_user_id', 'c0450004-0000-0000-0000-000000000004', false);
set role authenticated;
select accepter_invitation_concours(current_setting('app.concours_quintet_id')::uuid);
reset role;
select set_config('app.current_user_id', 'c0450006-0000-0000-0000-000000000006', false);
set role authenticated;
select accepter_invitation_concours(current_setting('app.concours_quintet_id')::uuid);
reset role;

do $$
declare
  v_count integer;
begin
  select count(*) into v_count from concours_publics where concours_id = current_setting('app.concours_quintet_id')::uuid;
  if v_count != 5 then
    raise exception 'TEST FAILED: Concours Quintet should show exactly 5 accepted participants, got %', v_count;
  end if;
  raise notice 'PASS: concours_publics correctly reports 5 accepted participants for an arbitrary N (Concours Quintet)';
end $$;

-- ---------------------------------------------------------------------
-- Winner determination once date_fin has passed and the underlying
-- campagnes are closed via the already-existing close_expired_campagnes()
-- (migration 0017) -- no new closing mechanism is built for the concours
-- itself, per the brief. close_expired_campagnes() only ever looks at
-- each campagne OFFRE's own config->>'date_fin' (never the concours'
-- own date_fin column, a separate field entirely) -- so this needs
-- dedicated campagnes with their own backdated date_fin, not the
-- Concours Duo/Trio/Quintet campagnes above (which were never given a
-- date_fin at all, so this sweep would never touch them).
-- ---------------------------------------------------------------------
insert into offres (id, createur_id, type, libelle, config, actif) values
  ('c0451101-0000-0000-0000-000000000001', 'c0450001-0000-0000-0000-000000000001', 'campagne', 'Campagne organisateur (close)', jsonb_build_object('description', 'x', 'objectif', 1000, 'date_fin', (current_date - interval '1 day')::date::text), true),
  ('c0451102-0000-0000-0000-000000000002', 'c0450002-0000-0000-0000-000000000002', 'campagne', 'Campagne B (close)', jsonb_build_object('description', 'x', 'objectif', 1000, 'date_fin', (current_date - interval '1 day')::date::text), true);

insert into transactions (id, fan_id, createur_id, offre_id, montant, statut) values
  ('c0452101-0000-0000-0000-000000000001', 'c0450005-0000-0000-0000-000000000005', 'c0450001-0000-0000-0000-000000000001', 'c0451101-0000-0000-0000-000000000001', 40, 'en_attente'),
  ('c0452102-0000-0000-0000-000000000002', 'c0450005-0000-0000-0000-000000000005', 'c0450002-0000-0000-0000-000000000002', 'c0451102-0000-0000-0000-000000000002', 25, 'en_attente');
update transactions set statut = 'validee' where id in ('c0452101-0000-0000-0000-000000000001', 'c0452102-0000-0000-0000-000000000002');
update transactions set statut = 'livree' where id in ('c0452101-0000-0000-0000-000000000001', 'c0452102-0000-0000-0000-000000000002');

select set_config('app.current_user_id', 'c0450001-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config(
  'app.concours_clos_id',
  (select creer_concours('Concours Clos', now() - interval '1 day', 'c0451101-0000-0000-0000-000000000001'))::text,
  false
);
select inviter_participant_concours(current_setting('app.concours_clos_id')::uuid, 'c0450002-0000-0000-0000-000000000002', 'c0451102-0000-0000-0000-000000000002');
reset role;
select set_config('app.current_user_id', 'c0450002-0000-0000-0000-000000000002', false);
set role authenticated;
select accepter_invitation_concours(current_setting('app.concours_clos_id')::uuid);
reset role;

-- Close the underlying campagnes via the pre-existing sweep -- the exact
-- same RPC the hourly cron already calls, nothing concours-specific.
select close_expired_campagnes();

do $$
declare
  v_actif_organisateur boolean;
  v_actif_b boolean;
  v_leader_id uuid;
  v_leader_montant numeric;
begin
  select actif into v_actif_organisateur from offres where id = 'c0451101-0000-0000-0000-000000000001';
  select actif into v_actif_b from offres where id = 'c0451102-0000-0000-0000-000000000002';
  if v_actif_organisateur or v_actif_b then
    raise exception 'TEST FAILED: close_expired_campagnes() did not close the underlying campagnes (actif organisateur=%, B=%)', v_actif_organisateur, v_actif_b;
  end if;

  select createur_id, montant_collecte into v_leader_id, v_leader_montant
    from concours_publics
    where concours_id = current_setting('app.concours_clos_id')::uuid
    order by montant_collecte desc
    limit 1;

  if v_leader_id != 'c0450001-0000-0000-0000-000000000001' or v_leader_montant != 40 then
    raise exception 'TEST FAILED: the winner should be the organisateur with 40 (got createur_id=%, montant=%)', v_leader_id, v_leader_montant;
  end if;

  raise notice 'PASS: once date_fin has passed and the underlying campagnes are closed via close_expired_campagnes(), concours_publics still reports the correct final montant_collecte per participant, correctly identifying the organisateur as the winner (40 > 25)';
end $$;

-- ---------------------------------------------------------------------
-- Security: same grant-audit discipline as every write RPC since
-- migration 0020 -- anon has no EXECUTE at all on any of the 4 new
-- functions, and authenticated with a genuinely NULL auth.uid() is
-- rejected by each function's own internal check. Positive check:
-- anon DOES have SELECT on concours_publics -- a shared concours link
-- must work for a logged-out visitor.
-- ---------------------------------------------------------------------
select set_config('app.current_user_id', '', false);
set role anon;
do $$
begin
  begin
    perform creer_concours('x', now() + interval '1 day', 'c0451001-0000-0000-0000-000000000001');
    raise exception 'TEST FAILED: anon was able to call creer_concours() at all';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no EXECUTE privilege on creer_concours()';
  end;
end $$;
do $$
begin
  begin
    perform inviter_participant_concours(current_setting('app.concours_duo_id')::uuid, 'c0450005-0000-0000-0000-000000000005', 'c0451001-0000-0000-0000-000000000001');
    raise exception 'TEST FAILED: anon was able to call inviter_participant_concours() at all';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no EXECUTE privilege on inviter_participant_concours()';
  end;
end $$;
do $$
begin
  begin
    perform accepter_invitation_concours(current_setting('app.concours_duo_id')::uuid);
    raise exception 'TEST FAILED: anon was able to call accepter_invitation_concours() at all';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no EXECUTE privilege on accepter_invitation_concours()';
  end;
end $$;
do $$
begin
  begin
    perform refuser_invitation_concours(current_setting('app.concours_duo_id')::uuid);
    raise exception 'TEST FAILED: anon was able to call refuser_invitation_concours() at all';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no EXECUTE privilege on refuser_invitation_concours()';
  end;
end $$;

-- Positive check: anon can read concours_publics.
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from concours_publics where concours_id = current_setting('app.concours_duo_id')::uuid;
  if v_count != 2 then
    raise exception 'TEST FAILED: anon could not read the expected rows from concours_publics (got %)', v_count;
  end if;
  raise notice 'PASS: anon has SELECT on concours_publics (a shared concours link works for a logged-out visitor)';
end $$;
reset role;

-- authenticated with a genuinely NULL auth.uid() -- defense in depth on
-- top of the EXECUTE revoke, same discipline as every write RPC since
-- migration 0020.
select set_config('app.current_user_id', '', false);
set role authenticated;
do $$
begin
  begin
    perform creer_concours('x', now() + interval '1 day', 'c0451001-0000-0000-0000-000000000001');
    raise exception 'TEST FAILED: creer_concours() succeeded with auth.uid() IS NULL';
  exception when others then
    if sqlerrm != 'not authenticated' then
      raise exception 'TEST FAILED: unexpected error calling creer_concours() with a NULL auth.uid(): %', sqlerrm;
    end if;
    raise notice 'PASS: creer_concours() rejects a call with auth.uid() IS NULL';
  end;
end $$;
do $$
begin
  begin
    perform inviter_participant_concours(current_setting('app.concours_duo_id')::uuid, 'c0450005-0000-0000-0000-000000000005', 'c0451001-0000-0000-0000-000000000001');
    raise exception 'TEST FAILED: inviter_participant_concours() succeeded with auth.uid() IS NULL';
  exception when others then
    if sqlerrm != 'not authenticated' then
      raise exception 'TEST FAILED: unexpected error calling inviter_participant_concours() with a NULL auth.uid(): %', sqlerrm;
    end if;
    raise notice 'PASS: inviter_participant_concours() rejects a call with auth.uid() IS NULL';
  end;
end $$;
do $$
begin
  begin
    perform accepter_invitation_concours(current_setting('app.concours_duo_id')::uuid);
    raise exception 'TEST FAILED: accepter_invitation_concours() succeeded with auth.uid() IS NULL';
  exception when others then
    if sqlerrm != 'not authenticated' then
      raise exception 'TEST FAILED: unexpected error calling accepter_invitation_concours() with a NULL auth.uid(): %', sqlerrm;
    end if;
    raise notice 'PASS: accepter_invitation_concours() rejects a call with auth.uid() IS NULL';
  end;
end $$;
do $$
begin
  begin
    perform refuser_invitation_concours(current_setting('app.concours_duo_id')::uuid);
    raise exception 'TEST FAILED: refuser_invitation_concours() succeeded with auth.uid() IS NULL';
  exception when others then
    if sqlerrm != 'not authenticated' then
      raise exception 'TEST FAILED: unexpected error calling refuser_invitation_concours() with a NULL auth.uid(): %', sqlerrm;
    end if;
    raise notice 'PASS: refuser_invitation_concours() rejects a call with auth.uid() IS NULL';
  end;
end $$;
reset role;

-- None of the rejected attack attempts above should have left any trace.
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from concours where nom = 'x';
  if v_count != 0 then
    raise exception 'TEST FAILED: a rejected creer_concours() attack left a concours row behind';
  end if;
  raise notice 'PASS: none of the rejected concours security attempts left any trace';
end $$;

-- Positive check: authenticated still holds EXECUTE on all 4 (the
-- revoke didn't overreach).
do $$
begin
  if not has_function_privilege('authenticated', 'creer_concours(text, timestamptz, uuid)', 'EXECUTE') then
    raise exception 'TEST FAILED: authenticated lost EXECUTE on creer_concours()';
  end if;
  if not has_function_privilege('authenticated', 'inviter_participant_concours(uuid, uuid, uuid)', 'EXECUTE') then
    raise exception 'TEST FAILED: authenticated lost EXECUTE on inviter_participant_concours()';
  end if;
  if not has_function_privilege('authenticated', 'accepter_invitation_concours(uuid)', 'EXECUTE') then
    raise exception 'TEST FAILED: authenticated lost EXECUTE on accepter_invitation_concours()';
  end if;
  if not has_function_privilege('authenticated', 'refuser_invitation_concours(uuid)', 'EXECUTE') then
    raise exception 'TEST FAILED: authenticated lost EXECUTE on refuser_invitation_concours()';
  end if;
  raise notice 'PASS: authenticated still holds EXECUTE on all 4 concours RPCs';
end $$;

-- ---------------------------------------------------------------------
-- Reserved pseudo: 'concours' (new /concours/[id] route, migration
-- 0045) -- same pattern as 'classement'/'offres'/'home' above.
-- ---------------------------------------------------------------------
do $$
begin
  begin
    update users set pseudo = 'Concours' where id = 'faceb001-0003-0003-0003-000000000003';
    raise exception 'TEST FAILED: the new "concours" route name was accepted as a pseudo';
  exception when check_violation then
    raise notice 'PASS: "concours" is rejected as a pseudo (reserved-word list kept in sync with the new route)';
  end;
end $$;

do $$
begin
  raise notice 'ALL SQL CHECKLIST TESTS PASSED';
end $$;
