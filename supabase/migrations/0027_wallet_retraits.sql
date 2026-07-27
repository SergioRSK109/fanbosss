-- Lot 2b -- créateur wallet ledger + withdrawal requests (minimum $25).
-- Nothing here changes how money actually moves (still no automated
-- payout to a créateur exists anywhere in this codebase -- see CLAUDE.md
-- "Automatic CinetPay refunds" for the same honesty about the fan-refund
-- side); this migration only tracks *how much* a créateur can ask to be
-- paid, and records that they asked.

create table demandes_retrait (
  id uuid primary key default gen_random_uuid(),
  createur_id uuid not null references users(id),
  montant numeric not null check (montant >= 25),
  statut text not null default 'en_attente'
    check (statut in ('en_attente', 'traite', 'refuse')),
  note_admin text,
  traite_par uuid references users(id),
  demande_at timestamptz not null default now(),
  traite_at timestamptz
);

alter table demandes_retrait enable row level security;

-- A créateur can see their own requests (the /finance page's own
-- historique), never anyone else's -- same "self-only for direct table
-- reads" default as every other user-owned table in this project. No
-- INSERT/UPDATE policy at all: every write goes through the two
-- SECURITY DEFINER RPCs below, same "state machine only via a vetted
-- RPC" shape as transactions/demandes_verification.
create policy demandes_retrait_select_own on demandes_retrait
  for select using (createur_id = auth.uid());

-- New top-level route (/finance) -- keep the reserved-pseudo list in
-- sync, same discipline as every previous route addition.
alter table users drop constraint users_pseudo_not_reserved;
alter table users add constraint users_pseudo_not_reserved
  check (
    pseudo is null or lower(pseudo) not in (
      'dashboard', 'signup', 'login', 'api', 'auth',
      'createur', 'mes-transactions', 'paiement', 'parametres', 'explorer',
      'mot-de-passe-oublie', 'reinitialiser-mot-de-passe', 'admin', 'classement',
      'finance'
    )
  );

-- The one authoritative wallet-balance computation, called both by
-- demander_retrait() (to validate a request server-side) and directly by
-- /finance's own display -- deliberately never duplicated between the two
-- call sites, same principle as calculerRepartitionPaiement() being the
-- single source of truth for the commission split.
--
-- Reusing the existing enum values is what makes this formula need no
-- special case at all for a litige resolved in the créateur's favor
-- (migration 0026): faveur_createur sets confirmation_fan = 'confirme',
-- the exact same value a normal fan confirmation produces, so it already
-- falls into net_a_retirer's `confirmation_fan in ('confirme',
-- 'non_applicable')` bucket with no extra branch here.
--
-- Takes p_createur_id as an explicit parameter (per instruction) rather
-- than reading auth.uid() implicitly like mes_progres_classement() does --
-- but still enforces p_createur_id = auth.uid() internally, so there is
-- no way to ask for anyone else's balance through this function; the
-- parameter only exists so demander_retrait() below can pass its own
-- auth.uid() through to the one shared query rather than this function
-- re-deriving it a second way.
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
      ), 0) as en_attente_livraison,
      coalesce((
        select sum(p.montant_net_createur)
        from paiements p
        join transactions t on t.id = p.transaction_id
        where t.createur_id = p_createur_id
          and p.statut_paiement = 'reussi'
          and t.confirmation_fan = 'conteste'
          and t.litige_resolu_at is null
      ), 0) as en_litige,
      coalesce((
        select sum(p.montant_net_createur)
        from paiements p
        join transactions t on t.id = p.transaction_id
        where t.createur_id = p_createur_id
          and p.statut_paiement = 'reussi'
          and t.confirmation_fan in ('confirme', 'non_applicable')
      ), 0)
      - coalesce((
        select sum(d.montant)
        from demandes_retrait d
        where d.createur_id = p_createur_id
          and d.statut != 'refuse'
      ), 0) as net_a_retirer;
end;
$$;

revoke all on function solde_wallet_createur(uuid) from public;
grant execute on function solde_wallet_createur(uuid) to authenticated;

-- Same SECURITY DEFINER discipline as every state-changing RPC since
-- migration 0020: auth.uid() required, and the $25 minimum plus the
-- available-balance check are both re-verified here in SQL -- never
-- trusting a pre-computed amount the client might send, since the client
-- is exactly what an attacker controls.
create or replace function demander_retrait(p_montant numeric)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_solde record;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if p_montant < 25 then
    raise exception 'le montant minimum de retrait est 25$';
  end if;

  -- Recomputed here, in SQL, from the same shared query
  -- solde_wallet_createur() exposes for display -- never a montant passed
  -- in from the app and trusted. p_createur_id = auth.uid() here always
  -- satisfies solde_wallet_createur's own ownership check.
  select * into v_solde from solde_wallet_createur(auth.uid());

  if p_montant > v_solde.net_a_retirer then
    raise exception 'le montant demandé dépasse le solde disponible';
  end if;

  insert into demandes_retrait (createur_id, montant, statut)
    values (auth.uid(), p_montant, 'en_attente')
    returning id into v_id;

  return v_id;
end;
$$;

revoke all on function demander_retrait(numeric) from public;
grant execute on function demander_retrait(numeric) to authenticated;

-- Admin decision on a withdrawal request -- same exact style as
-- resoudre_litige()/mark_remboursement_manuel_traite(): re-verifies
-- est_admin internally, revoke all from public + grant to authenticated
-- only. 'traite' means a real manual bank/mobile-money transfer already
-- happened outside this app (there is still no automated payout anywhere
-- in this codebase); this RPC only records that decision, it never moves
-- any money itself.
create or replace function traiter_retrait(p_id uuid, p_decision text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from users where id = auth.uid() and est_admin = true
  ) then
    raise exception 'not authorized';
  end if;

  if p_decision not in ('traite', 'refuse') then
    raise exception 'invalid decision: %', p_decision;
  end if;

  if not exists (
    select 1 from demandes_retrait where id = p_id and statut = 'en_attente'
  ) then
    raise exception 'demande not found or already handled';
  end if;

  update demandes_retrait
    set statut = p_decision,
        note_admin = p_note,
        traite_par = auth.uid(),
        traite_at = now()
    where id = p_id;
end;
$$;

revoke all on function traiter_retrait(uuid, text, text) from public;
grant execute on function traiter_retrait(uuid, text, text) to authenticated;
