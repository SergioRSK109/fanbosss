-- Repairing the referral (parrainage) system: the bonus itself has been
-- correctly calculated and stored since migration 0002
-- (handle_transaction_livraison(), 10% of the referred transaction's
-- commission, within the parrain's own 30-day window) -- but it never
-- once surfaced anywhere. solde_wallet_createur() (migration 0027) never
-- summed the parrainages table at all, and there was no UI anywhere
-- showing a créateur their own referral link. A parrain has been earning
-- real, correctly-computed money since the very first migration with no
-- way to ever see or withdraw it. This migration closes both gaps, plus
-- adds the one piece that was never built at all: a one-time reduced
-- commission for a filleul's own first transaction as créateur.

-- ---------------------------------------------------------------------
-- 1. Anti-abuse guard: a user can't be their own parrain. NULL passes
-- (the overwhelming majority of users, never referred by anyone) --
-- `!=` against NULL evaluates to NULL, which a CHECK constraint treats
-- as satisfied (a CHECK only ever rejects a row when its expression is
-- explicitly FALSE), so this is the correct operator here, unlike the
-- `!=`-against-auth.uid() bug fixed in migration 0020 (that was a
-- security check where a NULL needed to be REJECTED, not passed --
-- opposite requirement, opposite correct operator).
-- ---------------------------------------------------------------------
alter table users add constraint users_pas_auto_parrainage check (parrain_id != id);

-- ---------------------------------------------------------------------
-- 2. solde_wallet_createur() -- extended to fold the parrain's own
-- earned referral bonuses into net_a_retirer, alongside their créateur
-- earnings and (since migration 0047) their Maître du jeu earnings.
-- Per instruction: no change to parrainages.statut at all ('du'/'paye'
-- stays exactly as it's always been, still unused by anything) -- the
-- raw sum of every parrainages row where parrain_id = the caller is
-- added directly, and the existing "total earned minus total already
-- withdrawn" subtraction (demandes_retrait) is what naturally prevents
-- double-counting once a bonus has actually been withdrawn, with zero
-- extra bookkeeping needed on the parrainages table itself.
--
-- Deliberately NOT added to en_attente_livraison or en_litige: unlike a
-- créateur's own paiements row (which starts 'initie' and can be
-- disputed before ever becoming spendable), a parrainages row is only
-- ever inserted once the underlying transaction has already reached
-- 'livree' (handle_transaction_livraison(), migration 0002) -- there is
-- no earlier, not-yet-spendable state for a referral bonus to sit in,
-- and no confirmation_fan/litige concept applies to it (it isn't itself
-- a transaction). It's real, spendable money the moment it exists.
--
-- Same signature as before (create or replace, no drop) -- the existing
-- `authenticated`-only EXECUTE grant (migration 0027) is left untouched.
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
        + coalesce((
          select sum(pa.montant_bonus)
          from parrainages pa
          where pa.parrain_id = p_createur_id
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
-- 3. create_paiement_on_validation() -- extended with a one-time, 10%
-- HT commission (instead of the standard 15%, migration 0024) on a
-- filleul's very first transaction as créateur. Scope, stated plainly:
--
-- - Créateur-side only, never fan-side -- a fan never pays commission at
--   all (this trigger only ever runs against new.createur_id, so a
--   filleul who only ever pays as a fan simply never reaches this check
--   for themselves; being someone else's fan on a transaction never
--   consults their own parrain_id at all).
-- - Requires the créateur to have BEEN referred (users.parrain_id is not
--   null) -- a filleul who never becomes a créateur never gets a
--   discount on anything, because the discount only exists at the point
--   commission is charged on a transaction where they're the créateur.
-- - "First transaction" = the first time this créateur has ever had a
--   paiements row created at all, across every offer type -- checked at
--   the exact point this trigger already computes/freezes commission
--   (the transition into 'validee'), not at 'livree'. This is
--   deliberate, not a looser reading of the brief's own "jamais livrée"
--   wording: paiements rows are created and frozen once, permanently, at
--   'validee' (never recomputed later, see CLAUDE.md's "Commission
--   rate") -- there is no later point where re-checking this would even
--   be meaningful, and for don/contenu_debloque/evenement_live/campagne
--   (immediate-validation types) validee and livree happen in the same
--   webhook request anyway, so the distinction is moot for those types.
-- - One-time, permanent, independent of the parrain's own 30-day bonus
--   window (handle_transaction_livraison(), migration 0002) -- a
--   filleul's discount applies to their first transaction whenever it
--   happens, even if their parrain's own referral window has already
--   closed by then.
--
-- Concurrency: `perform ... for update` locks the créateur's own users
-- row before the "is this their first paiements row" check, so two
-- transactions reaching 'validee' for a genuinely brand-new créateur at
-- the same instant can't both read "no paiements row yet" and both walk
-- away with the discount -- the second waits for the first to commit,
-- then re-reads under a fresh snapshot that already includes the
-- first's insert. This mirrors reserver_stock_produit()'s own
-- row-locking discipline (migration 0039) for the same class of race.
--
-- Everything below this point (the maitre_du_jeu 3-way split, migration
-- 0047) is unchanged -- the discount only ever affects which commission
-- RATE feeds v_net_total; the split logic itself has no idea a discount
-- was ever applied.
-- ---------------------------------------------------------------------
create or replace function create_paiement_on_validation()
returns trigger
language plpgsql
as $$
declare
  v_est_filleul_premiere_transaction boolean;
  v_taux_commission numeric;
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
    perform 1 from users where id = new.createur_id for update;

    select
      (u.parrain_id is not null)
      and not exists (
        select 1 from paiements p
        join transactions t2 on t2.id = p.transaction_id
        where t2.createur_id = new.createur_id
      )
      into v_est_filleul_premiere_transaction
      from users u
      where u.id = new.createur_id;

    v_taux_commission := case when v_est_filleul_premiere_transaction then 0.10 else 0.15 end;

    v_commission := round(new.montant * v_taux_commission, 2);
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
