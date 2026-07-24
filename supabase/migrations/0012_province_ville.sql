-- Province/région and ville, both optional, collected at signup alongside
-- pays. Province comes from a dropdown (src/lib/states.ts, backed by an
-- ODbL dataset filtered to the countries in lib/countries.ts -- see
-- CREDITS.md) so it's stored as free text the same way `pays` already is
-- (the country's display name, not an ISO code) rather than a normalized
-- foreign key -- there's no other table that needs to join on it. Ville
-- has no usable finite list (too many cities worldwide), so it's plain
-- free text from the start. Max-length constraints mirror the existing
-- bio/nom_affichage pattern (0008/0009): the real guarantee for any
-- invariant on these columns has to live here, not in the signup form,
-- since signup calls supabase.auth.signUp() directly from the browser --
-- there is no server API route in front of it to validate first.
alter table users add column province text;
alter table users add column ville text;
alter table users add constraint users_province_max_length
  check (province is null or length(province) <= 100);
alter table users add constraint users_ville_max_length
  check (ville is null or length(ville) <= 100);

create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parrain_id uuid;
begin
  v_parrain_id := nullif(new.raw_user_meta_data->>'parrain_id', '')::uuid;

  insert into public.users (id, telephone, pays, province, ville, parrain_id, bio, lien_reseau_social)
  values (
    new.id,
    new.raw_user_meta_data->>'telephone',
    coalesce(new.raw_user_meta_data->>'pays', 'RDC'),
    new.raw_user_meta_data->>'province',
    new.raw_user_meta_data->>'ville',
    v_parrain_id,
    new.raw_user_meta_data->>'bio',
    new.raw_user_meta_data->>'lien_reseau_social'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;
