-- Fan gallery (Phase 3/4): /galerie is a new top-level route
-- (src/app/[locale]/galerie/page.tsx) sitting outside the (app) route
-- group, same level as /explorer and /classement. Same two-places
-- discipline as every previous route addition (finance in 0027, offres
-- in 0028, home in 0029, concours in 0045, ...): DB constraint here,
-- PSEUDO_MOTS_RESERVES in src/lib/validation.ts.
alter table users drop constraint users_pseudo_not_reserved;
alter table users add constraint users_pseudo_not_reserved
  check (
    pseudo is null or lower(pseudo) not in (
      'dashboard', 'signup', 'login', 'api', 'auth',
      'createur', 'mes-transactions', 'paiement', 'parametres', 'explorer',
      'mot-de-passe-oublie', 'reinitialiser-mot-de-passe', 'admin', 'classement',
      'finance', 'offres', 'home', 'concours', 'galerie'
    )
  );
