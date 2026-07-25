-- Fundraising campaigns: a new offre type reusing the exact same
-- "multiple rows per créateur, distinguished by libelle" mechanism
-- video already uses (unique_offre_type_par_createur, migration 0007,
-- NULLS NOT DISTINCT) -- no constraint change needed there, campagne
-- just becomes a second type that supplies a non-null libelle. libelle
-- holds the campaign's title.

alter table offres drop constraint offres_type_check;
alter table offres add constraint offres_type_check
  check (type in ('video', 'don', 'whatsapp', 'shoutout', 'contenu_debloque', 'evenement_live', 'campagne'));

-- Same free-amount mechanic as `don` -- the fan picks the contribution
-- amount at payment time, so campagne has no fixed prix either.
alter table offres drop constraint offres_prix_required_unless_don;
alter table offres add constraint offres_prix_required_unless_don
  check (type in ('don', 'campagne') or prix is not null);

-- ---------------------------------------------------------------------
-- Public views.
--
-- campagnes_publiques deliberately does NOT filter on actif=true, unlike
-- offres_publiques -- past campaigns (closed by reaching their goal or
-- by their date_fin passing) must stay visible on the créateur's public
-- profile as history, not disappear the moment they close. This is why
-- it's a separate view rather than a tweak to offres_publiques's WHERE
-- clause: offres_publiques's active-only filter is still exactly right
-- for every other offer type (an inactive whatsapp/video offer really
-- should stop being purchasable-looking on the profile).
--
-- config is included here (unlike offres_publiques, which excludes it
-- for every type since evenement_live's config holds a secret
-- pre-payment link) because none of campagne's config keys
-- (description/objectif/date_fin) are sensitive -- the progress bar and
-- description are meant to be fully public.
create view public.campagnes_publiques as
  select id, createur_id, libelle, actif, config, created_at
  from offres
  where type = 'campagne';

grant select on public.campagnes_publiques to authenticated, anon;

-- Montant collecté is deliberately never stored -- brief point 4: compute
-- it live from delivered transactions so it can never drift out of sync
-- with reality. This view only ever exposes the aggregate SUM per offre,
-- never individual transaction rows, so it can't be used to learn who
-- donated or how much any single fan gave -- same "aggregate only, never
-- raw rows" discipline as the classement_* views (which expose rank only,
-- never the underlying count/amount).
--
-- LEFT JOIN + coalesce so a brand-new campaign with zero contributions
-- still gets a row (montant_collecte = 0) instead of being absent from
-- the view entirely, which a plain inner join + group by would do.
create view public.campagnes_montant_collecte as
  select o.id as offre_id, coalesce(sum(t.montant), 0) as montant_collecte
  from offres o
  left join transactions t on t.offre_id = o.id and t.statut = 'livree'
  where o.type = 'campagne'
  group by o.id;

grant select on public.campagnes_montant_collecte to authenticated, anon;

-- ---------------------------------------------------------------------
-- Auto-close path 1: a contribution pushes the campaign to (or past) its
-- goal. Fires in the same AFTER UPDATE ON transactions moment every
-- other livree side-effect does (create_paiement_on_validation,
-- handle_transaction_livraison) -- by the time this trigger body runs,
-- the just-updated row is already visible to its own SELECT sum(...)
-- (same-transaction read of its own write), so the contribution that
-- just landed is correctly included in the total that decides whether
-- to close.
--
-- config->>'objectif' is guarded with an exception handler rather than a
-- bare ::numeric cast: config is untyped client-supplied JSON (like
-- every other offer type's config), and a malformed value here must
-- never be able to break an unrelated fan's payment webhook call --
-- same "a side effect must never break the primary flow" principle as
-- processAutomaticRefund() on the application side.
-- ---------------------------------------------------------------------
create or replace function close_campagne_if_goal_reached()
returns trigger
language plpgsql
as $$
declare
  v_offre offres%rowtype;
  v_objectif numeric;
  v_collecte numeric;
begin
  if new.statut = 'livree' and old.statut is distinct from 'livree' then
    select * into v_offre from offres where id = new.offre_id;

    if v_offre.type = 'campagne' and v_offre.actif then
      begin
        v_objectif := nullif(v_offre.config->>'objectif', '')::numeric;
      exception when others then
        v_objectif := null;
      end;

      if v_objectif is not null then
        select coalesce(sum(montant), 0) into v_collecte
          from transactions
          where offre_id = v_offre.id and statut = 'livree';

        if v_collecte >= v_objectif then
          update offres set actif = false where id = v_offre.id;
        end if;
      end if;
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_close_campagne_if_goal_reached
  after update on transactions
  for each row
  execute function close_campagne_if_goal_reached();

-- ---------------------------------------------------------------------
-- Auto-close path 2: date_fin passes without the goal being reached.
-- Nothing else naturally happens on that calendar date, so this can't be
-- event-triggered -- it reuses the same hourly external-cron
-- infrastructure process_transaction_deadlines() already relies on (see
-- /api/cron/check-deadlines), called as a second RPC from that same
-- route.
--
-- The date_fin ~ '^\d{4}-\d{2}-\d{2}$' guard exists for the same reason
-- as the exception handler above: this is a single batch UPDATE across
-- every créateur's campaigns, and one malformed date_fin must never be
-- able to abort the whole statement and block every other créateur's
-- legitimately-expired campaign from closing.
--
-- `< current_date` (strictly less than, not <=) means a campaign stays
-- open through the entirety of its date_fin day -- it closes starting
-- the day after, not at the first moment of date_fin itself.
-- ---------------------------------------------------------------------
create or replace function close_expired_campagnes()
returns table(offre_id uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update offres
    set actif = false
    where type = 'campagne'
      and actif = true
      and config->>'date_fin' ~ '^\d{4}-\d{2}-\d{2}$'
      and (config->>'date_fin')::date < current_date
    returning id;
end;
$$;
