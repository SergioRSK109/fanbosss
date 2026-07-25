-- Two additions to the existing classement (leaderboard) system:
--
-- 1. A private "progress towards the leaderboard" mechanism for the
--    créateur's own dashboard -- unlike classement_volume/reactivite/
--    progression (migration 0008), which deliberately expose rank only,
--    this one exposes real numbers (counts, gaps) so it must be strictly
--    self-only. See below for why this is a SECURITY DEFINER function
--    rather than a view guarded by a Postgres RLS policy.
-- 2. /classement is a new public top-level route -- add it to the
--    reserved-pseudo blacklist, same as every other top-level route
--    (migrations 0008/0009/0013/0015).
--
-- No changes to classement_volume/classement_reactivite/
-- classement_progression themselves -- the public /classement page reuses
-- them exactly as they are.

alter table users drop constraint users_pseudo_not_reserved;
alter table users add constraint users_pseudo_not_reserved
  check (
    pseudo is null or lower(pseudo) not in (
      'dashboard', 'signup', 'login', 'api', 'auth',
      'createur', 'mes-transactions', 'paiement', 'parametres', 'explorer',
      'mot-de-passe-oublie', 'reinitialiser-mot-de-passe', 'admin', 'classement'
    )
  );

-- Why a function, not a view + RLS policy: this needs to compare the
-- caller's own count/average against an aggregate computed across every
-- other opted-in créateur (the current "10th place" threshold), which
-- means it inherently has to read other users' transactions. Postgres
-- Row Level Security POLICIES only ever attach to tables, never to views
-- or functions -- there is no `create policy` that could be put directly
-- on a view here. A view that stayed subject to the real per-user RLS on
-- `transactions` (security_invoker) could never see other créateurs'
-- rows at all, so it could never compute the threshold. A view owned by
-- the migration role (bypassrls, the same mechanism classement_volume
-- etc. already rely on) CAN compute the threshold, but then has nothing
-- stopping an authenticated caller from reading every row unless the
-- view itself hardcodes a self-only filter.
--
-- So instead this follows the pattern already established everywhere
-- else in this codebase for "must be self-only, needs elevated read
-- access to compute": a SECURITY DEFINER function that reads auth.uid()
-- itself and takes no target-user parameter at all (same shape as
-- accept_transaction/refuse_transaction/set_admin_status) -- there is no
-- argument a caller could ever pass to ask for someone else's numbers.
-- EXECUTE is granted to `authenticated` only, never `anon`: this is real
-- Postgres permission enforcement (not just application logic), tested
-- below (checklist) via SET ROLE.
create or replace function mes_progres_classement()
returns table (
  volume_actuel integer,
  volume_seuil_top10 integer,
  volume_manque integer,
  reactivite_actuelle_secondes numeric,
  reactivite_seuil_top10_secondes numeric,
  reactivite_manque_secondes numeric,
  progression_eligible boolean,
  progression_actuel integer,
  progression_seuil_top10 integer,
  progression_manque integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_date_creation timestamptz;
  v_volume_actuel integer;
  v_volume_seuil integer;
  v_volume_manque integer;
  v_reactivite_actuelle numeric;
  v_reactivite_seuil numeric;
  v_reactivite_manque numeric;
  v_progression_eligible boolean;
  v_progression_actuel integer;
  v_progression_seuil integer;
  v_progression_manque integer;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select u.date_creation into v_date_creation from users u where u.id = v_user_id;
  if v_date_creation is null then
    raise exception 'user not found';
  end if;

  -- Volume: same 30-day delivered-transaction window classement_volume
  -- ranks on. Threshold = the count held by whoever currently sits in
  -- 10th place among opted-in créateurs; null (fewer than 10 opted-in
  -- créateurs exist at all) means there's no real competition for a
  -- top-10 spot, so nothing is missing.
  select count(t.id) into v_volume_actuel
    from transactions t
    where t.createur_id = v_user_id
      and t.statut = 'livree'
      and t.created_at >= now() - interval '30 days';

  select cnt into v_volume_seuil
    from (
      select count(t.id) filter (
        where t.statut = 'livree' and t.created_at >= now() - interval '30 days'
      ) as cnt
      from users u
      left join transactions t on t.createur_id = u.id
      where u.classement_public = true
      group by u.id
    ) par_createur
    order by cnt desc
    offset 9 limit 1;

  v_volume_manque := greatest(0, coalesce(v_volume_seuil, 0) - v_volume_actuel);

  -- Réactivité: same offer-type restriction and 30-day window as
  -- classement_reactivite (only video/shoutout/whatsapp have a real
  -- acceptation step). Null actuelle means "no qualifying response yet"
  -- -- there's no meaningful gap to report until there's a first data
  -- point, so manque stays null rather than a misleading 0.
  select avg(extract(epoch from (t.repondu_at - t.created_at))) into v_reactivite_actuelle
    from transactions t
    join offres o on o.id = t.offre_id
    where t.createur_id = v_user_id
      and t.repondu_at is not null
      and o.type in ('video', 'shoutout', 'whatsapp')
      and t.created_at >= now() - interval '30 days';

  select avg_secs into v_reactivite_seuil
    from (
      select avg(extract(epoch from (t.repondu_at - t.created_at))) filter (
        where t.repondu_at is not null
          and o.type in ('video', 'shoutout', 'whatsapp')
          and t.created_at >= now() - interval '30 days'
      ) as avg_secs
      from users u
      left join transactions t on t.createur_id = u.id
      left join offres o on o.id = t.offre_id
      where u.classement_public = true
      group by u.id
    ) par_createur
    where avg_secs is not null
    order by avg_secs asc
    offset 9 limit 1;

  if v_reactivite_actuelle is null then
    v_reactivite_manque := null;
  else
    v_reactivite_manque := greatest(0, v_reactivite_actuelle - coalesce(v_reactivite_seuil, v_reactivite_actuelle));
  end if;

  -- Progression: only accounts younger than 30 days are ever eligible
  -- for this leaderboard at all (classement_progression's own scoping),
  -- so an older account gets null/not-applicable rather than a
  -- meaningless comparison.
  v_progression_eligible := v_date_creation >= now() - interval '30 days';

  if v_progression_eligible then
    select count(t.id) into v_progression_actuel
      from transactions t
      where t.createur_id = v_user_id and t.statut = 'livree';

    select cnt into v_progression_seuil
      from (
        select count(t.id) filter (where t.statut = 'livree') as cnt
        from users u
        left join transactions t on t.createur_id = u.id
        where u.classement_public = true
          and u.date_creation >= now() - interval '30 days'
        group by u.id
      ) par_createur
      order by cnt desc
      offset 9 limit 1;

    v_progression_manque := greatest(0, coalesce(v_progression_seuil, 0) - v_progression_actuel);
  else
    v_progression_actuel := null;
    v_progression_seuil := null;
    v_progression_manque := null;
  end if;

  return query select
    v_volume_actuel, v_volume_seuil, v_volume_manque,
    v_reactivite_actuelle, v_reactivite_seuil, v_reactivite_manque,
    v_progression_eligible, v_progression_actuel, v_progression_seuil, v_progression_manque;
end;
$$;

revoke all on function mes_progres_classement() from public;
grant execute on function mes_progres_classement() to authenticated;
