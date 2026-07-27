-- Lot 3 -- tab-bar navigation reorg adds a new top-level route, /offres
-- (demandes en attente + configuration des offres, split out of what used
-- to be the /dashboard page). Same discipline as every previous route
-- addition (finance in 0027, classement in 0019, etc.): keep the reserved
-- pseudo list in sync in both places, DB constraint here and
-- PSEUDO_MOTS_RESERVES in src/lib/validation.ts.
alter table users drop constraint users_pseudo_not_reserved;
alter table users add constraint users_pseudo_not_reserved
  check (
    pseudo is null or lower(pseudo) not in (
      'dashboard', 'signup', 'login', 'api', 'auth',
      'createur', 'mes-transactions', 'paiement', 'parametres', 'explorer',
      'mot-de-passe-oublie', 'reinitialiser-mot-de-passe', 'admin', 'classement',
      'finance', 'offres'
    )
  );
