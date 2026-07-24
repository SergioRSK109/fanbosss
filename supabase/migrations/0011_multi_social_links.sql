-- Multiple simple social links (no OAuth, no official account linking) --
-- one per common platform plus a generic "autre", each optional. Plain
-- columns, same shape as the existing lien_reseau_social, which is left
-- completely untouched: it's collected at signup for manual identity
-- verification only, and is no longer what's shown to fans on the public
-- profile -- these four replace it there.
alter table users add column lien_tiktok text;
alter table users add column lien_instagram text;
alter table users add column lien_youtube text;
alter table users add column lien_autre text;

-- Trailing columns only -- CREATE OR REPLACE VIEW can add new trailing
-- columns but cannot reorder/insert among existing ones.
create or replace view public.profils_publics as
  select id, pays, devise, date_creation, pseudo, bio, photo_r2_key,
         lien_reseau_social, nom_affichage,
         lien_tiktok, lien_instagram, lien_youtube, lien_autre
  from users;
