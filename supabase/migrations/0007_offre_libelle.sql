-- Brief v3 follow-up: a créateur can have several `video` offers with
-- different labels/prices (e.g. "Anniversaire" at 10$, "Danse" at 15$),
-- while every other type keeps the strict one-offer-per-type rule.

alter table offres add column libelle text;

alter table offres drop constraint unique_offre_type_par_createur;

-- NULLS NOT DISTINCT (Postgres 15+) is what makes this actually enforce
-- "one row per type" for whatsapp/don/contenu_debloque/evenement_live,
-- whose libelle stays null: a plain UNIQUE constraint treats every NULL as
-- distinct from every other NULL, so two null-libelle rows of the same
-- type would NOT conflict and the one-per-type guarantee would silently
-- stop holding for exactly the types that most need it. Verified directly
-- before writing this: two inserts with the same (type, libelle=null)
-- collide under ON CONFLICT as expected, while a distinct libelle for the
-- same type does not.
alter table offres add constraint unique_offre_type_par_createur
  unique nulls not distinct (createur_id, type, libelle);

-- The public browsing view (migration 0006) needs libelle too, so fans see
-- which video offer is which ("Anniversaire" vs "Danse"). libelle must be
-- appended at the end of the column list -- CREATE OR REPLACE VIEW can add
-- new trailing columns but cannot reorder/insert among existing ones.
create or replace view public.offres_publiques as
  select id, createur_id, type, prix, actif, created_at, libelle
  from offres
  where actif = true;
