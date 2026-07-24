-- Two new top-level routes (password reset flow) added to the app --
-- keep the reserved-pseudo list in sync the same way every previous
-- top-level route addition has (0008/0009), or e.g. "reinitialiser-mot-de-
-- passe" could be claimed as a pseudo and collide with the real route.
-- Constraints can't be altered in place, so drop and recreate under the
-- same name -- see src/lib/validation.ts#PSEUDO_MOTS_RESERVES.
alter table users drop constraint users_pseudo_not_reserved;
alter table users add constraint users_pseudo_not_reserved
  check (
    pseudo is null or lower(pseudo) not in (
      'dashboard', 'signup', 'login', 'api', 'auth',
      'createur', 'mes-transactions', 'paiement', 'parametres', 'explorer',
      'mot-de-passe-oublie', 'reinitialiser-mot-de-passe'
    )
  );
