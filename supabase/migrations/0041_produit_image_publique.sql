-- Phase 3 of the "produit physique" offer type: the fan-facing product
-- card (ProduitCard.tsx) needs the créateur-uploaded image, which
-- offres_publiques (migration 0006/0007) never exposed -- image_r2_key
-- didn't exist as a column at all until migration 0039.
--
-- image_r2_key appended as a trailing column, same "CREATE OR REPLACE
-- VIEW can add new trailing columns but cannot reorder/insert among
-- existing ones" constraint migration 0007 already documented when it
-- added libelle here.
--
-- Deliberately no grant statement: recreating a view does not reset its
-- existing grants (verified empirically before relying on this exact
-- claim -- see CLAUDE.md), and nothing has ever revoked
-- authenticated/anon's SELECT on offres_publiques since migration 0006
-- first granted it (confirmed by grepping every migration for
-- "offres_publiques" before writing this file) -- restating the grant
-- here would be redundant, not a safety net.
create or replace view public.offres_publiques as
  select id, createur_id, type, prix, actif, created_at, libelle, image_r2_key
  from offres
  where actif = true;
