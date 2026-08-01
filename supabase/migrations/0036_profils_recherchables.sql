-- masque_exploration must only hide a créateur from passive/suggestive
-- discovery -- the default /explorer grid shown with no active search --
-- never from an active search, whether an exact pseudo or a fuzzy
-- keyword match against bio/nom_affichage/social links. A créateur who
-- opts out stays fully findable the moment someone types something; they
-- only disappear from what's shown with nothing typed.
--
-- This needs a second view alongside profils_explorables, not a boolean
-- flag threaded through one shared query, because the two now enforce
-- genuinely different WHERE clauses (masque_exploration filtered vs.
-- not) -- same "one view per public visibility rule" discipline already
-- used for profils_publics/profils_explorables/badges_fidelite_publics.
-- Same "has at least one active offre" population as profils_explorables
-- (a créateur with nothing to offer still isn't explorable via search
-- either) -- just without the masque_exploration filter, and with the
-- social-link columns the search now also matches against.
create view public.profils_recherchables as
  select p.id, p.pays, p.devise, p.date_creation, p.pseudo, p.bio,
         p.photo_r2_key, p.lien_reseau_social, p.nom_affichage,
         p.createur_verifie, p.lien_tiktok, p.lien_instagram,
         p.lien_youtube, p.lien_autre
  from profils_publics p
  where exists (
    select 1 from offres o where o.createur_id = p.id and o.actif = true
  );

grant select on public.profils_recherchables to authenticated, anon;
