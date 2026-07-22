-- FanBoss MVP schema
-- See brief section 3 for context. Constraints intentionally sit on the
-- billed/authoritative columns (not on client-controlled JSON) so they hold
-- regardless of which API path writes to the table.

create extension if not exists pgcrypto;

create table users (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('createur', 'fan', 'both')),
  telephone text,
  pays text default 'RDC',
  devise text default 'USD',
  parrain_id uuid references users(id),
  date_creation timestamptz not null default now()
);

create table offres (
  id uuid primary key default gen_random_uuid(),
  createur_id uuid not null references users(id),
  type text not null check (type in ('video', 'don', 'whatsapp')),
  prix numeric not null check (prix > 0),
  actif boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  -- Prix plancher WhatsApp imposé sur la colonne réellement facturée (prix),
  -- jamais sur un champ JSON modifiable par le créateur. Voir brief 0.2.
  constraint check_whatsapp_minimum_price
    check (type != 'whatsapp' or prix >= 500)
);

create table transactions (
  id uuid primary key default gen_random_uuid(),
  fan_id uuid not null references users(id),
  createur_id uuid not null references users(id),
  offre_id uuid not null references offres(id),
  montant numeric not null check (montant > 0),
  statut text not null default 'en_attente'
    check (statut in ('en_attente', 'validee', 'livree', 'remboursee', 'refusee')),
  livrable jsonb not null default '{}'::jsonb,
  reference_cinetpay text,
  -- Deadline pour CHAQUE étape avec délai : acceptation ET livraison.
  -- Voir brief 0.3 -- l'absence de deadline_acceptation dans une version
  -- précédente laissait un fan bloqué indéfiniment si le créateur ignorait
  -- la demande.
  deadline_acceptation timestamptz,
  deadline_livraison timestamptz,
  created_at timestamptz not null default now()
);

create table paiements (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references transactions(id) unique,
  montant_brut numeric not null,
  commission_plateforme numeric not null,
  frais_agregateur numeric not null,
  tva numeric not null,
  montant_net_createur numeric not null,
  statut_paiement text not null default 'initie'
    check (statut_paiement in ('initie', 'reussi', 'echoue', 'rembourse')),
  reference_cinetpay text,
  created_at timestamptz not null default now()
);

create table parrainages (
  id uuid primary key default gen_random_uuid(),
  parrain_id uuid not null references users(id),
  filleul_id uuid not null references users(id),
  transaction_id uuid not null references transactions(id),
  montant_bonus numeric not null,
  statut text not null default 'du' check (statut in ('du', 'paye')),
  created_at timestamptz not null default now(),
  -- Un seul bonus de parrainage par (transaction, filleul).
  constraint unique_parrainage_par_transaction unique (transaction_id, filleul_id)
);

create table parametres_plateforme (
  cle text primary key,
  valeur jsonb not null,
  updated_at timestamptz not null default now()
);

create table reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references users(id),
  reported_user_id uuid not null references users(id),
  type text not null check (type in ('signalement', 'blocage')),
  raison text,
  statut text not null default 'en_attente' check (statut in ('en_attente', 'traite', 'rejete')),
  created_at timestamptz not null default now()
);

create index idx_users_parrain_id on users(parrain_id);
create index idx_offres_createur_id on offres(createur_id);
create index idx_transactions_createur_id on transactions(createur_id);
create index idx_transactions_fan_id on transactions(fan_id);
create index idx_transactions_offre_id on transactions(offre_id);
create index idx_transactions_deadline_acceptation on transactions(deadline_acceptation);
create index idx_transactions_deadline_livraison on transactions(deadline_livraison);
create index idx_paiements_transaction_id on paiements(transaction_id);
create index idx_parrainages_parrain_id on parrainages(parrain_id);
create index idx_parrainages_filleul_id on parrainages(filleul_id);
create index idx_reports_reported_user_id on reports(reported_user_id);
