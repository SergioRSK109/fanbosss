-- Donor badge (badge_donateur): a public, opt-in tier badge based on a
-- user's own cumulative spend across the whole platform (every créateur
-- combined, not per-créateur -- distinct from the existing fan loyalty
-- badge, migration 0022, which is scoped to one specific fan/créateur
-- pair). Same opt-in-off-by-default pattern as badge_fidelite_public.
-- Plus a full, always-complete top-20 spenders ranking visible only in
-- /admin -- deliberately ignoring the opt-in, since it's a business
-- metric for the platform owner, not a public-facing feature.

alter table users add column badge_donateur_public boolean not null default false;

-- Pure, immutable: the highest threshold a given cumulative amount has
-- reached, or NULL below the smallest one (10). `max()` over the
-- filtered set is what makes this a single tier lookup rather than a
-- range of nine separate comparisons -- widening the palier list later
-- is a one-line array edit, nothing else in this function changes.
create or replace function calculer_palier_donateur(p_montant numeric)
returns numeric language sql immutable as $$
  select max(palier) from unnest(array[10,50,100,150,250,500,1000,1500,3000]::numeric[]) as palier
  where p_montant >= palier;
$$;

-- Same view-owner-bypasses-RLS mechanism as every other public aggregate
-- view in this project (classement_volume, profils_explorables,
-- campagnes_montant_collecte...) -- the view can freely read
-- paiements/transactions to compute the real total, while its own WHERE
-- clause (badge_donateur_public = true, and a real palier reached) is
-- the entire safety guarantee, not a grant. Deliberately exposes only
-- the palier, never the exact total_depense -- same "tier only, never
-- the raw underlying number" discipline this project already applies to
-- classement_volume/reactivite/progression (rank only, never the count)
-- and calculer_palier_donateur's own one-way rounding-down shape.
create view public.badges_donateur_publics as
  select u.id as user_id, u.pseudo,
    calculer_palier_donateur(coalesce(d.total_depense, 0)) as palier
  from users u
  join (
    select t.fan_id, sum(p.montant_brut) as total_depense
    from paiements p join transactions t on t.id = p.transaction_id
    where p.statut_paiement = 'reussi'
    group by t.fan_id
  ) d on d.fan_id = u.id
  where u.badge_donateur_public = true
    and calculer_palier_donateur(d.total_depense) is not null;

grant select on public.badges_donateur_publics to authenticated, anon;
