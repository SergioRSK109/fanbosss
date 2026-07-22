-- Proves brief checklist items 2 and 3 against a real Postgres instance
-- running the actual migrations (not a description of intended behavior).

insert into users (id, role) values
  ('11111111-1111-1111-1111-111111111111', 'createur'),
  ('22222222-2222-2222-2222-222222222222', 'fan');

-- ---------------------------------------------------------------------
-- Checklist item 2: a whatsapp offer can never be edited under $500,
-- enforced at the database level on the billed `prix` column.
-- ---------------------------------------------------------------------
insert into offres (id, createur_id, type, prix) values
  ('33333333-3333-3333-3333-333333333333',
   '11111111-1111-1111-1111-111111111111', 'whatsapp', 500);

do $$
begin
  begin
    insert into offres (createur_id, type, prix)
      values ('11111111-1111-1111-1111-111111111111', 'whatsapp', 499);
    raise exception 'TEST FAILED: whatsapp offre created at 499 (below floor)';
  exception when check_violation then
    raise notice 'PASS: creating a whatsapp offre below $500 is rejected at DB level';
  end;
end $$;

do $$
begin
  begin
    -- Simulates the PATCH route's UPDATE: dropping an existing whatsapp
    -- offer's price below $500 after the fact.
    update offres set prix = 5
      where id = '33333333-3333-3333-3333-333333333333';
    raise exception 'TEST FAILED: whatsapp offre price dropped to 5 via UPDATE';
  exception when check_violation then
    raise notice 'PASS: dropping an existing whatsapp offre below $500 is rejected at DB level';
  end;
end $$;

do $$
begin
  begin
    -- The pitfall from a previous attempt: writing a "safe-looking" value
    -- into the JSON config column must not matter, because the constraint
    -- is on `prix`, never on `config`.
    update offres set prix = 5, config = '{"prix_minimum": 500}'::jsonb
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
  if v_prix != 500 then
    raise exception 'TEST FAILED: offre prix was mutated to % despite rejected UPDATEs', v_prix;
  end if;
  raise notice 'PASS: offre prix is untouched (still 500) after the rejected UPDATE attempts';
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

do $$
begin
  raise notice 'ALL SQL CHECKLIST TESTS PASSED';
end $$;
