-- Phase 1 of the "produit physique" offer type: schema, atomic stock
-- reservation, and webhook wiring. Phases 2 (créateur UI on /offres) and
-- 3 (fan UI on /[handle]) are deliberately NOT built here -- this lot is
-- meant to be usable/testable in isolation via the RPC and the webhook
-- directly, per the brief. See CLAUDE.md's own section on this lot for
-- the full account.

-- ---------------------------------------------------------------------
-- 1. Schema.
-- ---------------------------------------------------------------------

alter table offres drop constraint offres_type_check;
alter table offres add constraint offres_type_check
  check (type in ('video', 'don', 'whatsapp', 'shoutout', 'contenu_debloque', 'evenement_live', 'campagne', 'produit'));

alter table offres add column stock_total integer;
alter table offres add column image_r2_key text;

-- stock_total is only ever meaningful (and required) for produit --
-- every other type must leave it null. It never changes after creation
-- (see the comment on reserver_stock_produit()/offres_disponibilite_produit
-- below): availability is always computed live from reservations_stock,
-- the same "compute live, never store a derived number" discipline this
-- project already applies to campagnes.montant_collecte.
alter table offres add constraint offres_stock_coherent
  check ((type = 'produit' and stock_total is not null and stock_total > 0)
      or (type != 'produit' and stock_total is null));

-- offres_prix_required_unless_don (migration 0017) already requires
-- prix is not null for any type other than don/campagne -- produit falls
-- under that existing rule with no change needed: a produit offer always
-- has a fixed per-unit price, unlike don/campagne's fan-chosen amount.

alter table transactions add column quantite integer not null default 1
  check (quantite > 0);

-- One row per reservation attempt, whether it ever converts into a real
-- sale or not. transaction_id is null for a reservation still only
-- "held" (webhook hasn't confirmed payment yet) and gets set the moment
-- the webhook confirms the corresponding payment -- that's what makes a
-- reservation permanent (see reserver_stock_produit()'s own comment for
-- why disponibilite is always computed from this table, never a stored
-- counter).
create table reservations_stock (
  id uuid primary key default gen_random_uuid(),
  offre_id uuid not null references offres(id),
  fan_id uuid not null references users(id),
  quantite integer not null check (quantite > 0),
  expire_at timestamptz not null,
  transaction_id uuid references transactions(id),
  created_at timestamptz not null default now()
);
create index idx_reservations_stock_offre on reservations_stock(offre_id);

-- No INSERT/UPDATE/DELETE policy at all for authenticated -- same "state
-- machine only via a vetted RPC" shape as transactions/publications/
-- demandes_verification. A fan reserves via reserver_stock_produit()
-- below; the webhook confirms (sets transaction_id) via the service-role
-- client, same as every other transaction-creating path in this
-- codebase, which bypasses RLS entirely regardless of policy.
--
-- A self-only SELECT policy IS needed, though, unlike those other
-- write-only tables: /api/transactions/initiate (section 4) re-verifies
-- a submitted reservationId actually belongs to the calling fan using
-- the caller's own authenticated client (never service-role, so a fan
-- can't be tricked into having someone else's reservation validated) --
-- without this policy that read would come back empty even for the
-- reservation's real owner, breaking the legitimate flow, not just the
-- forged one.
alter table reservations_stock enable row level security;
create policy reservations_stock_select_own on reservations_stock
  for select using (fan_id = auth.uid());

-- ---------------------------------------------------------------------
-- 2. reserver_stock_produit(p_offre_id, p_quantite) -- atomic reservation.
--
-- Locks the offres row (`select ... for update`) to serialize concurrent
-- reservation attempts on the SAME offre: every caller racing for the
-- last unit must acquire this row lock before it can even read
-- disponibilite, so the second caller's read of reservations_stock is
-- guaranteed to already reflect the first caller's just-inserted row (or
-- the first caller's transaction to have aborted) by the time it gets to
-- read it. This is the standard "lock the parent row to serialize an
-- aggregate-then-insert against a child table" pattern for inventory --
-- verified empirically against a real concurrent race before being
-- trusted here, per this project's standing discipline for exactly this
-- class of non-obvious Postgres mechanism (see CLAUDE.md's own section
-- on this lot for the full account of that verification).
--
-- disponible_maintenant (the number available for a NEW reservation right
-- now) subtracts every reservation that's either already confirmed
-- (transaction_id is not null -- a real sale) or still within its
-- 10-minute hold window (expire_at > now()) -- an expired, unconfirmed
-- hold no longer counts against the total, freeing that stock back up
-- for the very next caller to see.
create or replace function reserver_stock_produit(p_offre_id uuid, p_quantite integer)
returns table (reservation_id uuid, expire_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offre offres%rowtype;
  v_reserve numeric;
  v_disponible numeric;
  v_id uuid;
  v_expire timestamptz;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if p_quantite is null or p_quantite <= 0 then
    raise exception 'quantité invalide';
  end if;

  select * into v_offre from offres where id = p_offre_id for update;

  if v_offre.id is null then
    raise exception 'offre introuvable';
  end if;

  if v_offre.type != 'produit' then
    raise exception 'cette offre n''est pas un produit physique';
  end if;

  if not v_offre.actif then
    raise exception 'cette offre n''est plus disponible';
  end if;

  -- Table-qualified throughout this query: reserver_stock_produit's own
  -- OUT parameter (expire_at) would otherwise shadow
  -- reservations_stock.expire_at, resolving the unqualified reference to
  -- the (always-null-here) OUT parameter instead of the table column --
  -- the exact same class of bug already documented for
  -- creer_demande_verification()/publier_message()/
  -- toggler_repost_publication() in this codebase. Caught empirically,
  -- not spotted by inspection, by actually running this function against
  -- a throwaway database before trusting it -- see CLAUDE.md's own
  -- section on this lot.
  select coalesce(sum(rs.quantite), 0) into v_reserve
    from reservations_stock rs
    where rs.offre_id = p_offre_id
      and (rs.transaction_id is not null or rs.expire_at > now());

  v_disponible := v_offre.stock_total - v_reserve;

  if p_quantite > v_disponible then
    raise exception 'stock insuffisant : % disponible(s), % demandé(s)', v_disponible, p_quantite;
  end if;

  v_expire := now() + interval '10 minutes';

  insert into reservations_stock (offre_id, fan_id, quantite, expire_at)
    values (p_offre_id, auth.uid(), p_quantite, v_expire)
    returning id into v_id;

  return query select v_id, v_expire;
end;
$$;

revoke all on function reserver_stock_produit(uuid, integer) from public;
grant execute on function reserver_stock_produit(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------
-- 3. offres_disponibilite_produit -- public view, one row per produit
-- offer.
--
-- disponible_definitif never includes an in-flight (unconfirmed) hold --
-- only real sales (transaction_id is not null) permanently reduce it,
-- which is exactly what the webhook checks after confirming a sale to
-- decide whether to close the offer (see the webhook section below).
--
-- prochaine_liberation deliberately exposes ONLY the timing of the
-- soonest-expiring active hold, never who placed it -- fan_id must never
-- leak through this view.
-- ---------------------------------------------------------------------
create view public.offres_disponibilite_produit as
select
  o.id as offre_id,
  o.stock_total
    - coalesce((
        select sum(r.quantite) from reservations_stock r
        where r.offre_id = o.id
          and (r.transaction_id is not null or r.expire_at > now())
      ), 0) as disponible_maintenant,
  o.stock_total
    - coalesce((
        select sum(r.quantite) from reservations_stock r
        where r.offre_id = o.id and r.transaction_id is not null
      ), 0) as disponible_definitif,
  (
    select min(r.expire_at) from reservations_stock r
    where r.offre_id = o.id and r.transaction_id is null and r.expire_at > now()
  ) as prochaine_liberation
from offres o
where o.type = 'produit';

grant select on public.offres_disponibilite_produit to authenticated, anon;
