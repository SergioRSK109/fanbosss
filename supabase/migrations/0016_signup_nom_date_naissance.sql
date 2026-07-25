-- Two additions to signup: nom/post-nom (concatenated straight into the
-- already-existing nom_affichage column -- no new columns for them, see
-- SignupForm.tsx) and a real, database-enforced 18+ age gate.

-- date_naissance: nullable, same reasoning as province/ville (0012) --
-- every existing row predates this column and can't be retroactively
-- assigned a birth date, so it can't be NOT NULL at the table level.
-- SignupForm.tsx makes the field required going forward; this column
-- only guarantees it can never represent an under-18 date once set, not
-- that it's always set.
--
-- The CHECK itself was verified empirically against a throwaway table
-- before trusting it here (not assumed): a row exactly 18 years old
-- today passes, one day younger fails, 19 years old passes, and NULL
-- passes (Postgres CHECK constraints only ever reject a row when the
-- expression evaluates to FALSE -- NULL is neither true nor false, so it
-- never fails a CHECK on its own).
alter table users add column date_naissance date;
alter table users add constraint users_date_naissance_majorite
  check (date_naissance is null or date_naissance <= current_date - interval '18 years');

-- handle_new_auth_user (0005/0006/0008/0012) starts picking up two more
-- signup-metadata keys: nom_affichage (already an existing, freely
-- editable-later column -- SignupForm.tsx does the "{nom} {postnom}"
-- concatenation client-side before calling signUp(), so this trigger
-- doesn't need to know about nom/postnom as separate fields at all) and
-- date_naissance. Everything else is unchanged from 0012.
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

  insert into public.users (
    id, telephone, pays, province, ville, date_naissance, nom_affichage,
    parrain_id, bio, lien_reseau_social
  )
  values (
    new.id,
    new.raw_user_meta_data->>'telephone',
    coalesce(new.raw_user_meta_data->>'pays', 'RDC'),
    new.raw_user_meta_data->>'province',
    new.raw_user_meta_data->>'ville',
    nullif(new.raw_user_meta_data->>'date_naissance', '')::date,
    new.raw_user_meta_data->>'nom_affichage',
    v_parrain_id,
    new.raw_user_meta_data->>'bio',
    new.raw_user_meta_data->>'lien_reseau_social'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;
