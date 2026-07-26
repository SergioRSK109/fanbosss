-- Fan loyalty badge (non-monetary), opt-in per user, same pattern as
-- classement_public/masque_exploration: a single boolean the user
-- controls from /parametres, defaulting to the private/off state.
--
-- "Supporter de [créateur] depuis [date]" -- the date is never stored: it
-- is always the min(created_at) of that fan's 'livree' transactions with
-- that specific créateur, computed live, exactly the same principle
-- already applied to campagnes_montant_collecte (migration 0017) --
-- never a second copy of a number/date that's already derivable and
-- could drift out of sync with the real transactions.
alter table users add column badge_fidelite_public boolean not null default false;

-- Why a VIEW with a hardcoded privacy filter, not a SECURITY DEFINER
-- function: this needs no elevated per-caller logic at all (unlike
-- mes_progres_classement, which has to compare the caller against a
-- cross-user threshold) -- it's a plain aggregate over `transactions`/
-- `users`, filtered once, by a column value, not by auth.uid(). Same
-- shape as profils_explorables/classement_volume (migration 0009/0008):
-- owned by the migration role (bypassrls in a real Supabase project), so
-- it can freely read `transactions`/`users` to compute the aggregate,
-- but the WHERE clause itself is the safety guarantee -- a row for a
-- given fan only ever appears here if that fan has already opted in
-- (badge_fidelite_public = true). There is no parameter to bypass this
-- with (no way to ask for a non-opted-in fan's row), and nothing here
-- needs the vulnerable pattern migration 0020/0021 just closed (no
-- EXECUTE grant is even relevant to a view).
--
-- Exposes exactly three columns -- fan_id, createur_id, depuis -- never
-- a transaction count or a montant, matching the same "aggregate rank/
-- date only" discipline as classement_volume etc. Used two directions by
-- the application: filtered by createur_id (a créateur's public
-- "Supporters" section) and filtered by fan_id (a fan's own public
-- profile, listing which créateurs they support).
create view public.badges_fidelite_publics as
  select
    t.fan_id,
    t.createur_id,
    min(t.created_at) as depuis
  from transactions t
  join users u on u.id = t.fan_id
  where t.statut = 'livree'
    and u.badge_fidelite_public = true
  group by t.fan_id, t.createur_id;

grant select on public.badges_fidelite_publics to authenticated, anon;
