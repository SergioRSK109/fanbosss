-- Phase C: Explorer becomes a publications grid (Instagram-style) instead
-- of a créateur-profile-card list. This view is the population behind
-- that grid's default, no-search state.
--
-- Same "verified créateurs + FanBoss announcements" population as
-- publications_accueil (migration 0029), narrowed further:
--   - visibilite = 'public' only -- a locked "soutiens" teaser in a
--     discovery grid would clutter it without converting a visitor who
--     doesn't know the créateur yet, unlike the feed (/home) where a
--     teaser still has a point (a supporter's own following list).
--   - masque_exploration = false -- same opt-out this créateur already
--     gets for profils_explorables (migration 0009); consistent, not a
--     new rule. Unlike profils_explorables's own SELECT list, this
--     column itself is still never exposed (see that view's own
--     comment for why -- a caller must never be able to tell an
--     opted-out créateur apart from one with nothing to post yet).
--   - no mute filter, unlike publications_accueil -- Explorer is an
--     active discovery surface for every visitor, not one viewer's own
--     personalized feed, so there is no auth.uid()-scoped exclusion to
--     apply here at all.
create view public.publications_explorables as
  select v.*
  from publications_visibles v
  join users u on u.id = v.auteur_id
  where v.visibilite = 'public'
    and (u.createur_verifie = true or v.type = 'annonce_fanboss')
    and u.masque_exploration = false;

-- Public discovery surface, no auth required, same grant shape as every
-- other public view already reachable from a logged-out visitor
-- (profils_explorables, publications_visibles).
grant select on public.publications_explorables to authenticated, anon;
