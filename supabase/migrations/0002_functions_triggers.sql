-- Business-rule enforcement that must hold regardless of which API path
-- writes to the table (mirrors the lesson of brief 0.2: invariants belong
-- in the database, not only in application code).

-- ---------------------------------------------------------------------
-- 1. deadline_acceptation is set automatically at creation, per offer type.
--    video -> +24h, whatsapp -> +48h, don -> null (no acceptation step).
-- ---------------------------------------------------------------------
create or replace function set_deadline_acceptation()
returns trigger
language plpgsql
as $$
declare
  v_offre_type text;
begin
  select type into v_offre_type from offres where id = new.offre_id;

  if v_offre_type is null then
    raise exception 'offre_id % does not reference an existing offre', new.offre_id;
  end if;

  new.deadline_acceptation := case v_offre_type
    when 'video' then now() + interval '24 hours'
    when 'whatsapp' then now() + interval '48 hours'
    else null
  end;

  return new;
end;
$$;

create trigger trg_set_deadline_acceptation
  before insert on transactions
  for each row
  execute function set_deadline_acceptation();

-- ---------------------------------------------------------------------
-- 2. When a transaction transitions into 'validee', a video offer gets a
--    fresh deadline_livraison (+48h from acceptance, not from payment).
-- ---------------------------------------------------------------------
create or replace function set_deadline_livraison()
returns trigger
language plpgsql
as $$
declare
  v_offre_type text;
begin
  if new.statut = 'validee' and old.statut is distinct from 'validee' then
    select type into v_offre_type from offres where id = new.offre_id;

    if v_offre_type = 'video' then
      new.deadline_livraison := now() + interval '48 hours';
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_set_deadline_livraison
  before update on transactions
  for each row
  execute function set_deadline_livraison();

-- ---------------------------------------------------------------------
-- 3. Financial calculations, frozen at 'validee' time (never recomputed
--    on the fly -- brief 4.5).
-- ---------------------------------------------------------------------
create or replace function create_paiement_on_validation()
returns trigger
language plpgsql
as $$
declare
  v_commission numeric;
  v_frais numeric;
  v_tva numeric;
begin
  if new.statut = 'validee' and old.statut is distinct from 'validee' then
    v_commission := round(new.montant * 0.20, 2);
    v_frais := round(new.montant * 0.03, 2);
    v_tva := round(v_commission * 0.16, 2);

    insert into paiements (
      transaction_id, montant_brut, commission_plateforme,
      frais_agregateur, tva, montant_net_createur,
      statut_paiement, reference_cinetpay
    )
    values (
      new.id, new.montant, v_commission,
      v_frais, v_tva, new.montant - v_commission - v_frais - v_tva,
      'initie', new.reference_cinetpay
    )
    on conflict (transaction_id) do nothing;
  end if;

  return new;
end;
$$;

create trigger trg_create_paiement_on_validation
  after update on transactions
  for each row
  execute function create_paiement_on_validation();

-- ---------------------------------------------------------------------
-- 4. On delivery ('livree'), mark the payment as transferred and generate
--    referral bonuses for whichever party (fan and/or createur) was
--    referred within their 30-day window (brief 4.4).
-- ---------------------------------------------------------------------
create or replace function handle_transaction_livraison()
returns trigger
language plpgsql
as $$
declare
  v_commission numeric;
  v_user record;
begin
  if new.statut = 'livree' and old.statut is distinct from 'livree' then
    update paiements set statut_paiement = 'reussi'
      where transaction_id = new.id
      returning commission_plateforme into v_commission;

    if v_commission is not null then
      for v_user in
        select id, parrain_id, date_creation
        from users
        where id in (new.fan_id, new.createur_id)
          and parrain_id is not null
      loop
        if now() <= v_user.date_creation + interval '30 days' then
          insert into parrainages (parrain_id, filleul_id, transaction_id, montant_bonus)
          values (v_user.parrain_id, v_user.id, new.id, round(v_commission * 0.10, 2))
          on conflict (transaction_id, filleul_id) do nothing;
        end if;
      end loop;
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_handle_transaction_livraison
  after update on transactions
  for each row
  execute function handle_transaction_livraison();

-- ---------------------------------------------------------------------
-- 5. On refund, reflect it on the payment record if one already exists
--    (it may not: an acceptation-deadline refund happens while the
--    transaction is still 'en_attente', before any paiement row exists).
-- ---------------------------------------------------------------------
create or replace function handle_transaction_remboursement()
returns trigger
language plpgsql
as $$
begin
  if new.statut = 'remboursee' and old.statut is distinct from 'remboursee' then
    update paiements set statut_paiement = 'rembourse'
      where transaction_id = new.id;
  end if;

  return new;
end;
$$;

create trigger trg_handle_transaction_remboursement
  after update on transactions
  for each row
  execute function handle_transaction_remboursement();

-- ---------------------------------------------------------------------
-- 6. State-transition RPCs (SECURITY DEFINER) so créateurs can only ever
--    move a transaction through the allowed states -- never write an
--    arbitrary statut directly via a table UPDATE grant.
-- ---------------------------------------------------------------------
create or replace function accept_transaction(p_transaction_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx record;
  v_offre_type text;
begin
  select * into v_tx from transactions where id = p_transaction_id for update;

  if v_tx is null then
    raise exception 'transaction not found';
  end if;

  if v_tx.createur_id != auth.uid() then
    raise exception 'not authorized';
  end if;

  if v_tx.statut != 'en_attente' then
    raise exception 'transaction is not pending acceptance';
  end if;

  if v_tx.deadline_acceptation is not null and now() > v_tx.deadline_acceptation then
    raise exception 'acceptation deadline has passed';
  end if;

  select type into v_offre_type from offres where id = v_tx.offre_id;

  update transactions set statut = 'validee' where id = p_transaction_id;

  -- WhatsApp: l'acceptation EST la livraison (numéro révélé immédiatement).
  if v_offre_type = 'whatsapp' then
    update transactions set statut = 'livree' where id = p_transaction_id;
  end if;
end;
$$;

create or replace function refuse_transaction(p_transaction_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx record;
begin
  select * into v_tx from transactions where id = p_transaction_id for update;

  if v_tx is null then
    raise exception 'transaction not found';
  end if;

  if v_tx.createur_id != auth.uid() then
    raise exception 'not authorized';
  end if;

  if v_tx.statut != 'en_attente' then
    raise exception 'transaction is not pending acceptance';
  end if;

  update transactions set statut = 'remboursee' where id = p_transaction_id;
end;
$$;

create or replace function deliver_video(p_transaction_id uuid, p_r2_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx record;
  v_offre_type text;
begin
  select * into v_tx from transactions where id = p_transaction_id for update;

  if v_tx is null then
    raise exception 'transaction not found';
  end if;

  if v_tx.createur_id != auth.uid() then
    raise exception 'not authorized';
  end if;

  select type into v_offre_type from offres where id = v_tx.offre_id;
  if v_offre_type != 'video' then
    raise exception 'only video offers are delivered via this function';
  end if;

  if v_tx.statut != 'validee' then
    raise exception 'transaction has not been accepted yet';
  end if;

  if v_tx.deadline_livraison is not null and now() > v_tx.deadline_livraison then
    raise exception 'delivery deadline has passed';
  end if;

  update transactions
    set statut = 'livree', livrable = jsonb_build_object('r2_key', p_r2_key)
    where id = p_transaction_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Hourly deadline cron, handling BOTH deadline types separately
--    (brief 0.3 / 4.2.4). Intended to be invoked by the /api/cron route
--    via the Postgres function (service role), so it runs even if no
--    fan or créateur ever takes action.
-- ---------------------------------------------------------------------
create or replace function process_transaction_deadlines()
returns table(transaction_id uuid, reason text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with expired_acceptation as (
    update transactions
      set statut = 'remboursee'
      where statut = 'en_attente'
        and deadline_acceptation is not null
        and deadline_acceptation < now()
      returning id, 'deadline_acceptation_depassee' as reason
  ),
  expired_livraison as (
    update transactions
      set statut = 'remboursee'
      where statut = 'validee'
        and deadline_livraison is not null
        and deadline_livraison < now()
      returning id, 'deadline_livraison_depassee' as reason
  )
  select expired_acceptation.id, expired_acceptation.reason from expired_acceptation
  union all
  select expired_livraison.id, expired_livraison.reason from expired_livraison;
end;
$$;
