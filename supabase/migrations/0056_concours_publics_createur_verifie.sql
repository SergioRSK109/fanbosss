-- Surfaces createur_verifie on concours_publics (migration 0045, last
-- redefined by 0052) so the créateur-contests public page can show the
-- same "✓ Vérifié" badge every other public identity surface
-- (CreateurProfileView, publications, /classement) now shows -- see
-- CLAUDE.md's "verified badge follows the créateur everywhere" section.
-- Trailing column only (CREATE OR REPLACE VIEW can append, never
-- reorder/insert among existing columns -- same constraint already
-- documented for publications_visibles/publications_accueil), byte-
-- identical otherwise to 0052's own definition, including its own
-- suspended/banned exclusion logic, which needs no change at all: a
-- participant/organisateur already excluded by that logic never reaches
-- this new column either.
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
    c.temps_record,
    u.createur_verifie
  from concours c
  join users organisateur on organisateur.id = c.organisateur_id
  left join concours_participants cp
    on cp.concours_id = c.id and cp.invite_statut = 'accepte'
  left join users u on u.id = cp.createur_id
  left join campagnes_montant_collecte cmc on cmc.offre_id = cp.campagne_id
  where organisateur.statut_compte = 'actif'
    and (cp.createur_id is null or u.statut_compte = 'actif');

-- No grant restatement -- concours_publics has been granted to
-- authenticated+anon since migration 0045 and has never had that
-- narrowed, so CREATE OR REPLACE VIEW's own grant-preserving behavior is
-- sufficient (see CLAUDE.md's migration 0037 note on why a grant should
-- only ever be restated when there's a real reason to believe it might
-- have been narrowed since).
