-- Pseudo change cool-down (30 days). Enforced with a trigger, not only in
-- the API route -- users_update_self (migration 0003) lets an
-- authenticated user PATCH their own `users` row directly via the
-- Supabase REST API for any column, bypassing our Next.js route
-- entirely, so an app-level-only check would be trivial to skip. Mirrors
-- this codebase's established philosophy (see migration 0002's header
-- comment): invariants belong in the database, not only in application
-- code.
alter table users add column pseudo_modifie_at timestamptz;

create or replace function enforce_pseudo_cooldown()
returns trigger
language plpgsql
as $$
begin
  if new.pseudo is distinct from old.pseudo then
    if old.pseudo_modifie_at is not null
       and now() < old.pseudo_modifie_at + interval '30 days' then
      -- Custom SQLSTATE (rather than the default P0001 every plain `raise
      -- exception` gets) so callers -- including this migration's own SQL
      -- tests -- can catch this specific condition instead of any
      -- generic exception.
      raise exception 'pseudo can only be changed again on %',
        old.pseudo_modifie_at + interval '30 days'
        using errcode = 'FB001';
    end if;

    new.pseudo_modifie_at := now();
  else
    -- Force pseudo_modifie_at back to its previous value regardless of
    -- what the caller attempted to send: it's a normal column, so
    -- users_update_self otherwise lets a self-update set it directly,
    -- which would let someone manufacture their own cooldown window
    -- (e.g. backdate it to defeat the check above on a later request).
    new.pseudo_modifie_at := old.pseudo_modifie_at;
  end if;

  return new;
end;
$$;

create trigger trg_enforce_pseudo_cooldown
  before update on users
  for each row
  execute function enforce_pseudo_cooldown();
