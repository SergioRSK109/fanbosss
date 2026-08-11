-- Distinguishes a campagne's NATURAL closure (date_fin passed, or the
-- objectif was reached -- close_expired_campagnes()/
-- close_campagne_if_goal_reached(), both migration 0017, neither
-- touched by this migration at all) from a créateur MANUALLY
-- deactivating it via the existing désactiver/réactiver toggle. Until
-- now, both cases looked identical (actif = false), which was already
-- known to be the reason campagnes_publiques deliberately never filters
-- on actif -- a naturally-closed campagne has to stay visible as public
-- history (see migration 0017's own comment). But that same "never
-- filter on actif" choice meant a créateur had no way to actually HIDE a
-- campagne they'd manually turned off -- it kept showing up in their
-- public history forever, indistinguishable from one that simply ran its
-- course. This migration adds the missing second signal so the two cases
-- can finally be told apart.

alter table offres add column desactive_manuellement boolean not null default false;

-- campagnes_publiques (migration 0017, its genere_pour_concours_id
-- trailing column added by migration 0048) gains a WHERE clause on this
-- new column, on top of its still-unchanged "never filter on actif"
-- behavior: a naturally-closed campagne (actif = false,
-- desactive_manuellement = false, since neither closing trigger ever
-- sets this new column) stays visible exactly as before. A manually
-- deactivated one (desactive_manuellement = true) disappears entirely --
-- and reappears the instant the créateur reactivates it, since
-- reactivating flips this same column back to false in the same
-- application-level write that flips actif back to true (see
-- POST /api/offres and PATCH /api/offres/[id]).
create or replace view public.campagnes_publiques as
  select id, createur_id, libelle, actif, config, created_at, genere_pour_concours_id
  from offres
  where type = 'campagne' and desactive_manuellement = false;

-- No grant restatement -- campagnes_publiques has been granted to
-- authenticated+anon since migration 0017 and has never had that
-- narrowed.
