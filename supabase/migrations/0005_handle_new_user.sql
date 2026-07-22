-- Creates the matching public.users row the moment someone signs up via
-- Supabase Auth, so auth.uid() always resolves to a real profile -- this
-- must hold for every signup path (password, magic link, future OAuth),
-- not just the one the signup form happens to call.
create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_parrain_id uuid;
begin
  v_role := coalesce(new.raw_user_meta_data->>'role', 'fan');
  v_parrain_id := nullif(new.raw_user_meta_data->>'parrain_id', '')::uuid;

  insert into public.users (id, role, telephone, parrain_id)
  values (
    new.id,
    v_role,
    new.raw_user_meta_data->>'telephone',
    v_parrain_id
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger trg_handle_new_auth_user
  after insert on auth.users
  for each row
  execute function handle_new_auth_user();
