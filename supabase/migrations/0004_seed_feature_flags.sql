-- Feature flags for functionality intentionally out of scope for the MVP
-- (brief 4.6). All disabled by default; flip the `valeur` to activate
-- without a redeploy or migration.
insert into parametres_plateforme (cle, valeur) values
  ('abonnements_actifs', 'false'::jsonb),
  ('avis_actifs', 'false'::jsonb),
  ('multi_devise_actif', 'false'::jsonb),
  ('multi_agregateur_actif', 'false'::jsonb)
on conflict (cle) do nothing;
