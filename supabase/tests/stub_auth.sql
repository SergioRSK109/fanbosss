-- Minimal stand-in for the `auth` schema Supabase provides in production,
-- so migrations that reference auth.uid()/auth.users can be applied and
-- exercised against a plain local Postgres for testing. Never run this
-- against a real Supabase project -- it already has a real `auth` schema.
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('app.current_user_id', true), '')::uuid
$$;

-- Supabase provisions these roles in every real project; stub them here so
-- GRANTs in the migrations apply the same way locally.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role;
  end if;
end $$;
