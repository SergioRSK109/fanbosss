-- Cover photo (product ask): a créateur can set a banner image shown at
-- the top of their public profile, above the existing avatar/name --
-- purely cosmetic, same "not sensitive but still signed, not a public
-- bucket URL" treatment as the existing profile photo (see
-- profil.ts#PHOTO_SIGNED_URL_EXPIRY_SECONDS). Uploaded through the exact
-- same presigned-R2 pipeline the profile photo already uses
-- (/api/profil/photo-upload-url is fully generic -- it signs a key under
-- profils/{userId}/{uuid} regardless of what field the caller eventually
-- writes it to, so no new upload route was needed).

alter table users add column photo_couverture_r2_key text;

-- Appended at the end of the existing column list, never reordering or
-- touching the others -- same discipline as every previous
-- create-or-replace-view migration in this project (0009, 0011, 0023).
create or replace view public.profils_publics as
  select id, pays, devise, date_creation, pseudo, bio, photo_r2_key,
         lien_reseau_social, nom_affichage,
         lien_tiktok, lien_instagram, lien_youtube, lien_autre,
         createur_verifie, photo_couverture_r2_key
  from users;
