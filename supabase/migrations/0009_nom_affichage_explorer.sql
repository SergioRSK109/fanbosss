-- 1. Display name: distinct from the technical pseudo (the /@handle).
-- Freeform, optional, no format/uniqueness constraint -- unlike pseudo it
-- isn't used for routing, just shown. A reasonable max length is enough.
alter table users add column nom_affichage text;
alter table users add constraint users_nom_affichage_max_length
  check (nom_affichage is null or length(nom_affichage) <= 60);

-- 2. Explorer visibility opt-out. Deliberately the OPPOSITE default
-- direction from classement_public: exploration visibility defaults ON
-- the moment a créateur has an active offre, whereas the leaderboards
-- stay opt-in. This asymmetry is why the app shows a one-time
-- transparency notice the first time a créateur creates an offre (see
-- POST /api/offres) -- the default must never be silent, especially for
-- sensitive use cases (a pastor collecting donations who'd rather stay
-- unlisted, per the product brief).
alter table users add column masque_exploration boolean not null default false;

-- 'explorer' is now a top-level route -- add it to the reserved-pseudo
-- blacklist (migration 0008, kept in sync with
-- src/lib/validation.ts#PSEUDO_MOTS_RESERVES). Constraints can't be
-- altered in place, so drop and recreate under the same name.
alter table users drop constraint users_pseudo_not_reserved;
alter table users add constraint users_pseudo_not_reserved
  check (
    pseudo is null or lower(pseudo) not in (
      'dashboard', 'signup', 'login', 'api', 'auth',
      'createur', 'mes-transactions', 'paiement', 'parametres', 'explorer'
    )
  );

-- 3. nom_affichage must show up everywhere the créateur profile is shown
-- publicly (product brief) -- append to profils_publics. Trailing column
-- only: CREATE OR REPLACE VIEW can add new trailing columns but cannot
-- reorder/insert among existing ones.
create or replace view public.profils_publics as
  select id, pays, devise, date_creation, pseudo, bio, photo_r2_key,
         lien_reseau_social, nom_affichage
  from users;

-- 4. Explorer listing: automatically includes any créateur with at least
-- one active offre, unless they've opted out via masque_exploration.
-- Deliberately does NOT expose masque_exploration itself in the result --
-- callers never need to know a créateur hid themselves, they just don't
-- show up. Owned by the migration role (BYPASSRLS in a real Supabase
-- project), same mechanism already relied on for every other public view
-- in this file -- see CLAUDE.md's testing discipline note on views.
create view public.profils_explorables as
  select p.id, p.pays, p.devise, p.date_creation, p.pseudo, p.bio,
         p.photo_r2_key, p.lien_reseau_social, p.nom_affichage
  from profils_publics p
  join users u on u.id = p.id
  where u.masque_exploration = false
    and exists (
      select 1 from offres o where o.createur_id = p.id and o.actif = true
    );

grant select on public.profils_explorables to authenticated, anon;
