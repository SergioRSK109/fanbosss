-- Account suspension/ban by an admin (CGU article 3.5: "FanBoss se
-- réserve le droit de suspendre ou de fermer le compte d'un utilisateur
-- en cas de violation des présentes CGU"). Until now nothing enforced
-- that promise -- even a repeatedly-reported account or a créateur who
-- lost a litige stayed fully active forever. This migration builds the
-- missing mechanism.
--
-- Deliberately NOT the same thing as a (separately designed, never sent
-- to Claude Code) "deactivate my own account" feature -- that one is
-- reversible by the user themselves and blocks on an undelivered paid
-- order. This one is admin-only, never reversible by the affected user,
-- and -- the one already-settled principle worth restating here -- must
-- ALWAYS be possible even with transactions in flight: otherwise any
-- account could shield itself from a ban by simply accepting a pending
-- order the moment it senses trouble. In-flight transactions are
-- refunded automatically (into the existing manual-refund queue) rather
-- than ever blocking the admin's action.

-- ---------------------------------------------------------------------
-- 1. Schema.
-- ---------------------------------------------------------------------

alter table users add column statut_compte text not null default 'actif'
  check (statut_compte in ('actif', 'suspendu', 'banni'));
alter table users add column statut_compte_raison text;
alter table users add column statut_compte_change_par uuid references users(id);
alter table users add column statut_compte_change_at timestamptz;

-- ---------------------------------------------------------------------
-- 2. RPCs.
--
-- appliquer_statut_compte() is a private, non-SECURITY-DEFINER helper --
-- never granted to anyone, only ever callable from inside another
-- SECURITY DEFINER function's already-elevated, already-admin-verified
-- execution context (same reuse pattern as
-- verifier_campagne_du_createur(), migration 0046). This is what lets
-- suspendre_compte()/bannir_compte() stay two distinct, explicitly-named
-- RPCs -- clearer in logs/audits than one function taking a level
-- parameter, per explicit instruction -- without duplicating the actual
-- state-change logic (status write + offres/publications/transactions
-- side effects) three times over.
--
-- Re-entrancy guard: "not exists a row for p_user_id whose statut_compte
-- already differs from p_statut" doubles as both "user not found" (zero
-- rows at all) and "already in that exact status" (a row exists but
-- doesn't satisfy the != filter) -- same shape as every other admin RPC's
-- "not found or already handled" guard in this project
-- (mark_remboursement_manuel_traite, resoudre_litige,
-- traiter_signalement_publication).
create or replace function appliquer_statut_compte(p_user_id uuid, p_statut text, p_raison text)
returns void
language plpgsql
as $$
begin
  if not exists (
    select 1 from users where id = p_user_id and statut_compte is distinct from p_statut
  ) then
    raise exception 'user not found or already %', p_statut;
  end if;

  update users
    set statut_compte = p_statut,
        statut_compte_raison = p_raison,
        statut_compte_change_par = auth.uid(),
        statut_compte_change_at = now()
    where id = p_user_id;

  -- Every offre this créateur owns stops being purchasable-looking --
  -- same actif=false toggle the créateur's own désactiver/réactiver
  -- button already uses, just applied in bulk. Left untouched:
  -- desactive_manuellement (migration 0049) -- this is an admin action,
  -- not the créateur manually pausing a campagne, and campagnes_publiques
  -- below is independently filtered on statut_compte regardless of that
  -- column's value, so leaving it false doesn't leak anything back.
  update offres set actif = false where createur_id = p_user_id and actif = true;

  -- Every publication this account authored stops being shown -- same
  -- masque flag admin moderation (masquer_publication(), migration 0030)
  -- already uses. Unlike masquer_ma_publication()'s own one-way design,
  -- this is a plain flag flip: reactiver_compte_admin() below doesn't
  -- unmask anything automatically (see its own comment), an admin can
  -- still unmask an individual publication later via the existing
  -- masquer_publication() tool if that's ever actually wanted.
  update publications set masque = true where auteur_id = p_user_id and masque = false;

  -- In-flight transactions where this account is the CRÉATEUR (never the
  -- fan side -- refunding a créateur's transaction because their FAN got
  -- suspended would make no sense) are pushed straight to remboursee.
  -- This rides the exact same handle_transaction_remboursement() trigger
  -- (migration 0002/0014) every other refund path in this project
  -- already fires through -- paiements.statut_paiement='rembourse' and
  -- necessite_remboursement_manuel=true land in the existing manual-
  -- refund worklist, exactly like resoudre_litige()'s own faveur_fan
  -- branch. No new refund mechanism, no direct CinetPay call from here
  -- (this is a plain SQL function, it has no way to make one) -- see
  -- CLAUDE.md for why this reuse, not a new system, is the point.
  update transactions set statut = 'remboursee'
    where createur_id = p_user_id and statut in ('en_attente', 'validee');
end;
$$;

revoke all on function appliquer_statut_compte(uuid, text, text) from public;

create or replace function suspendre_compte(p_user_id uuid, p_raison text)
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

  perform appliquer_statut_compte(p_user_id, 'suspendu', p_raison);
end;
$$;

revoke all on function suspendre_compte(uuid, text) from public;
grant execute on function suspendre_compte(uuid, text) to authenticated;

create or replace function bannir_compte(p_user_id uuid, p_raison text)
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

  perform appliquer_statut_compte(p_user_id, 'banni', p_raison);
end;
$$;

revoke all on function bannir_compte(uuid, text) from public;
grant execute on function bannir_compte(uuid, text) to authenticated;

-- Admin-only, deliberately with no counterpart the affected user could
-- ever call themselves -- unlike the separately-designed voluntary
-- account deactivation, an admin decision must never be something the
-- sanctioned party can undo on their own. Clears the reason (nothing
-- left to explain once active again) but deliberately does NOT restore
-- offres.actif/publications.masque -- those are the créateur's own
-- levers to pull back on afterward (désactiver/réactiver, or an admin
-- individually unmasking a publication via the existing
-- masquer_publication()); auto-restoring everything the moment an
-- account is reactivated risks surfacing content nobody has re-reviewed.
create or replace function reactiver_compte_admin(p_user_id uuid)
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

  if not exists (
    select 1 from users where id = p_user_id and statut_compte != 'actif'
  ) then
    raise exception 'user not found or already active';
  end if;

  update users
    set statut_compte = 'actif',
        statut_compte_raison = null,
        statut_compte_change_par = auth.uid(),
        statut_compte_change_at = now()
    where id = p_user_id;
end;
$$;

revoke all on function reactiver_compte_admin(uuid) from public;
grant execute on function reactiver_compte_admin(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Public-view audit -- every view that joins/reads `users`, patched
-- so a suspended or banned account disappears everywhere, "exactly
-- comme si le compte n'existait plus". Found via a real grep across
-- every migration for `create (or replace) view` (17 views total, the
-- complete set -- confirmed no others exist), not from a written list
-- carried over from memory. Each is `create or replace` from its own
-- current, final definition (the one still live after every later
-- migration that touched it) -- never a stale, superseded copy.
-- ---------------------------------------------------------------------

-- profils_publics (final shape: migration 0035) -- the root of two more
-- views below (profils_explorables, profils_recherchables) that both
-- select FROM this one rather than the raw table, so filtering here
-- alone is what makes both of those correct too, with no separate
-- CREATE OR REPLACE needed for either: neither's own column list
-- changes, only the row set flowing in from this view shrinks.
create or replace view public.profils_publics as
  select id, pays, devise, date_creation, pseudo, bio, photo_r2_key,
         lien_reseau_social, nom_affichage,
         lien_tiktok, lien_instagram, lien_youtube, lien_autre,
         createur_verifie, photo_couverture_r2_key
  from users
  where statut_compte = 'actif';

-- offres_publiques (final shape: migration 0041) -- was a plain select
-- off the raw `offres` table with no users join at all; needed one added
-- purely to filter by the owning créateur's status.
create or replace view public.offres_publiques as
  select o.id, o.createur_id, o.type, o.prix, o.actif, o.created_at, o.libelle, o.image_r2_key
  from offres o
  join users u on u.id = o.createur_id
  where o.actif = true and u.statut_compte = 'actif';

-- offres_disponibilite_produit (migration 0039) -- exposes no identity
-- column at all (offre_id + numbers only), but a suspended/banned
-- créateur's stock/availability must still stop being computable through
-- it, same "as if it didn't exist" principle.
create or replace view public.offres_disponibilite_produit as
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
join users u on u.id = o.createur_id
where o.type = 'produit' and u.statut_compte = 'actif';

grant select on public.offres_disponibilite_produit to authenticated, anon;

-- campagnes_publiques (final shape: migration 0049) -- deliberately
-- never filters on offres.actif (a naturally-closed campagne must stay
-- visible as public history, see migration 0017) -- statut_compte is a
-- second, independent reason to exclude a row entirely, same as
-- desactive_manuellement already is.
create or replace view public.campagnes_publiques as
  select o.id, o.createur_id, o.libelle, o.actif, o.config, o.created_at, o.genere_pour_concours_id
  from offres o
  join users u on u.id = o.createur_id
  where o.type = 'campagne' and o.desactive_manuellement = false and u.statut_compte = 'actif';

-- publications_visibles (final shape: migration 0043) -- two identities
-- matter here, not one: the publication's own auteur (direct exclusion),
-- and -- for a repost row -- the referenced ORIGINAL's own auteur too.
-- This extends the exact masking cascade already established for
-- orig.masque=true (a repost of a masked post disappears too, migration
-- 0031/0032): a repost of a suspended/banned créateur's content is
-- excluded the same way, not left dangling with an embeddable-but-now-
-- teaserless original.
create or replace view public.publications_visibles as
  select
    p.id,
    p.auteur_id,
    p.type,
    case when peut_voir_publication_complete(p.auteur_id, p.visibilite)
      then p.contenu else null end as contenu,
    case when peut_voir_publication_complete(p.auteur_id, p.visibilite)
      then p.image_r2_key else null end as image_r2_key,
    p.visibilite,
    p.created_at,
    peut_voir_publication_complete(p.auteur_id, p.visibilite) as contenu_complet,
    p.repost_de_id,
    p.autorise_repost,
    (select count(*) from publications_likes pl where pl.publication_id = p.id)::int as likes_count,
    (select count(*) from publications_partages pp where pp.publication_id = p.id)::int as partages_count,
    (select count(*) from publications rc where rc.repost_de_id = p.id)::int as reposts_count,
    exists (
      select 1 from publications_likes pl
      where pl.publication_id = p.id and pl.fan_id = auth.uid()
    ) as viewer_a_aime,
    exists (
      select 1 from publications_partages pp
      where pp.publication_id = p.id and pp.fan_id = auth.uid()
    ) as viewer_a_partage,
    exists (
      select 1 from publications rp
      where rp.repost_de_id = p.id and rp.auteur_id = auth.uid()
    ) as viewer_a_reposte,
    case when peut_voir_publication_complete(p.auteur_id, p.visibilite)
      then p.video_r2_key else null end as video_r2_key,
    p.vues_count
  from publications p
  join users ua on ua.id = p.auteur_id
  left join publications orig on orig.id = p.repost_de_id
  left join users uo on uo.id = orig.auteur_id
  where p.masque = false
    and ua.statut_compte = 'actif'
    and (p.repost_de_id is null or (orig.masque = false and uo.statut_compte = 'actif'));

-- publications_accueil/publications_explorables both still read
-- `select v.*` straight from publications_visibles with an unchanged
-- column list, so neither needs recreating -- both inherit this
-- exclusion automatically the moment the view underneath them shrinks.

-- badges_fidelite_publics (migration 0022) -- two identities again: the
-- opted-in fan (already gated by badge_fidelite_public, now also by
-- their own account status) AND the créateur being supported -- a
-- suspended/banned créateur's "Supporters" section must not exist at
-- all, and a fan's own "badges de fidélité" list must not name a
-- créateur who's been removed from the platform either.
create or replace view public.badges_fidelite_publics as
  select
    t.fan_id,
    t.createur_id,
    min(t.created_at) as depuis
  from transactions t
  join users uf on uf.id = t.fan_id
  join users uc on uc.id = t.createur_id
  where t.statut = 'livree'
    and uf.badge_fidelite_public = true
    and uf.statut_compte = 'actif'
    and uc.statut_compte = 'actif'
  group by t.fan_id, t.createur_id;

-- badges_donateur_publics (migration 0051).
create or replace view public.badges_donateur_publics as
  select u.id as user_id, u.pseudo,
    calculer_palier_donateur(coalesce(d.total_depense, 0)) as palier
  from users u
  join (
    select t.fan_id, sum(p.montant_brut) as total_depense
    from paiements p join transactions t on t.id = p.transaction_id
    where p.statut_paiement = 'reussi'
    group by t.fan_id
  ) d on d.fan_id = u.id
  where u.badge_donateur_public = true
    and u.statut_compte = 'actif'
    and calculer_palier_donateur(d.total_depense) is not null;

-- classement_volume / classement_reactivite / classement_progression
-- (migration 0008, never redefined since) -- each already joins `users`
-- and filters `classement_public = true`; statut_compte is a second,
-- independent gate on the exact same join, same as everywhere else in
-- this migration.
create or replace view public.classement_volume as
  select
    u.id as createur_id,
    rank() over (
      order by count(t.id) filter (
        where t.statut = 'livree' and t.created_at >= now() - interval '30 days'
      ) desc
    ) as rang
  from users u
  left join transactions t on t.createur_id = u.id
  where u.classement_public = true and u.statut_compte = 'actif'
  group by u.id;

create or replace view public.classement_reactivite as
  select
    u.id as createur_id,
    rank() over (
      order by avg(
        extract(epoch from (t.repondu_at - t.created_at))
      ) filter (
        where t.repondu_at is not null
          and o.type in ('video', 'shoutout', 'whatsapp')
          and t.created_at >= now() - interval '30 days'
      ) asc nulls last
    ) as rang
  from users u
  left join transactions t on t.createur_id = u.id
  left join offres o on o.id = t.offre_id
  where u.classement_public = true and u.statut_compte = 'actif'
  group by u.id;

create or replace view public.classement_progression as
  select
    u.id as createur_id,
    rank() over (
      order by count(t.id) filter (where t.statut = 'livree') desc
    ) as rang
  from users u
  left join transactions t on t.createur_id = u.id
  where u.classement_public = true
    and u.statut_compte = 'actif'
    and u.date_creation >= now() - interval '30 days'
  group by u.id;

-- concours_publics (final shape: migration 0048) -- two distinct
-- identities can be suspended/banned here: an accepted PARTICIPANT
-- (excluded entirely, not just anonymized -- a plain LEFT JOIN would
-- otherwise still surface createur_id/campagne_id/montant_collecte with
-- pseudo/photo nulled out, which still leaks that a specific offre
-- belongs to a real, still-tracked account) and the concours'
-- ORGANISATEUR (a maitre_du_jeu concours can exist -- and even be
-- displayed -- with zero accepted participants at all, migration 0047's
-- LEFT JOIN restructure, so the organisateur is the only identity a
-- participant-less concours has). The phantom "zero participants yet"
-- row (migration 0047) is preserved: cp.createur_id is null in that
-- case, so it's never filtered out by the participant-status check.
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
    c.photo_trophee_r2_key,
    c.date_debut,
    c.objectif_points,
    c.temps_record
  from concours c
  join users organisateur on organisateur.id = c.organisateur_id
  left join concours_participants cp
    on cp.concours_id = c.id and cp.invite_statut = 'accepte'
  left join users u on u.id = cp.createur_id
  left join campagnes_montant_collecte cmc on cmc.offre_id = cp.campagne_id
  where organisateur.statut_compte = 'actif'
    and (cp.createur_id is null or u.statut_compte = 'actif');

-- concours_vainqueur_objectif (migration 0048) -- not in the brief's own
-- minimal list, but found by the same grep and genuinely in scope: this
-- view decides a tournament's WINNER purely from transaction totals per
-- créateur, with no users join at all as originally written. Without
-- this, a suspended/banned participant's own past contributions could
-- still crown them winner even though concours_publics above no longer
-- shows them as a participant at all -- extended here for the same
-- "as if the account didn't exist" reasoning, not left as a gap.
create or replace view public.concours_vainqueur_objectif as
with deadlines as (
  select
    concours.id as concours_id,
    coalesce(concours.temps_record, concours.date_fin) as deadline,
    concours.objectif_points
  from concours
  where concours.objectif_points is not null
),
cumulatifs as (
  select
    d.concours_id,
    cp.createur_id,
    t.created_at,
    d.objectif_points,
    sum(t.montant) over (
      partition by d.concours_id, cp.createur_id
      order by t.created_at, t.id
    ) as cumul
  from deadlines d
  join concours_participants cp
    on cp.concours_id = d.concours_id and cp.invite_statut = 'accepte'
  join users u
    on u.id = cp.createur_id and u.statut_compte = 'actif'
  join transactions t
    on t.offre_id = cp.campagne_id and t.statut = 'livree'
  where t.created_at < d.deadline
),
premiers_par_participant as (
  select concours_id, createur_id, min(created_at) as atteint_a
  from cumulatifs
  where cumul >= objectif_points
  group by concours_id, createur_id
)
select distinct on (concours_id)
  concours_id,
  createur_id,
  atteint_a
from premiers_par_participant
order by concours_id, atteint_a asc, createur_id asc;

-- No grant restatement on any of the views above: CREATE OR REPLACE VIEW
-- doesn't reset existing grants (verified empirically and documented
-- repeatedly in this project, see CLAUDE.md), and none of these had
-- their anon/authenticated SELECT touched by anything since they were
-- first granted -- confirmed by grepping every migration that mentions
-- each view's name before writing this file. offres_disponibilite_produit
-- is the one exception restated above, matching its own original
-- migration's own style of always pairing a `create view` (not `create
-- or replace`, originally) with an explicit grant right below it.
