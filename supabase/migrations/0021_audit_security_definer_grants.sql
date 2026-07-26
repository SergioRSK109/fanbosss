-- Audit requested after finding the accept_transaction/refuse_transaction/
-- deliver_video anonymous-caller bypass (migration 0020): checked every
-- other SECURITY DEFINER function in this project for the same "EXECUTE
-- never revoked from public" oversight. Confirmed empirically for each
-- one (has_function_privilege + a live `SET ROLE anon` call against a
-- throwaway database), not assumed from reading the code alone.
--
-- Two functions were a REAL, confirmed gap: `process_transaction_deadlines()`
-- and `close_expired_campagnes()`. Neither ever had EXECUTE revoked/scoped
-- at all (both relied on Postgres's default PUBLIC grant on newly created
-- functions) and neither has any internal auth check -- they're global
-- sweeps with no per-caller scoping by design, meant to be called only by
-- the hourly external cron via the service-role client (see
-- src/app/api/cron/check-deadlines/route.ts). `SET ROLE anon;` (no
-- session at all) successfully called both directly: it refunded a real
-- overdue transaction via `process_transaction_deadlines()` and closed a
-- real expired campagne via `close_expired_campagnes()`. Unlike the
-- migration 0020 bug this can't be pointed at a specific victim's
-- not-yet-overdue data, but it's still a real hole: anyone on the
-- internet could force either sweep to run on demand instead of waiting
-- for the trusted hourly cron. Fixed by revoking from public and granting
-- EXECUTE to `service_role` only -- no ordinary user, authenticated or
-- not, has any legitimate reason to call either directly, and the cron
-- route already calls both via createSupabaseServiceRoleClient().
--
-- `set_admin_status()` and `mark_remboursement_manuel_traite()` had the
-- same missing-revoke oversight, but confirmed NOT actually exploitable:
-- both check `not exists (select 1 from users where id = auth.uid() and
-- est_admin = true))`. Unlike the `!=` bug, `id = auth.uid()` with
-- auth.uid() NULL matches zero rows (an equality against NULL is simply
-- never true for any real id, not an ambiguous comparison the way `!=`
-- was), so `not exists(...)` correctly evaluates to `true` and `raise
-- exception 'not authorized'` fires exactly as intended. Verified with a
-- live anonymous call against both: `set_admin_status` on a real user and
-- `mark_remboursement_manuel_traite` on a real flagged transaction, both
-- rejected with `not authorized`, both left completely untouched
-- (est_admin still false, necessite_remboursement_manuel still true).
-- Still tightened here for defense in depth and consistency with every
-- other admin RPC in this file: revoked from public, granted to
-- `authenticated` only (never `anon` -- an admin action always requires a
-- real session), matching how both admin API routes already call them via
-- the authenticated client, never service-role.
--
-- `handle_new_auth_user()` also never had EXECUTE revoked, but this is
-- not a real gap either: it's a trigger function (`returns trigger`), and
-- Postgres itself refuses to invoke a trigger function directly
-- regardless of any grant -- confirmed live: `select handle_new_auth_user()`
-- as `anon` fails with `ERROR: trigger functions can only be called as
-- triggers`, a Postgres-level restriction, not something this codebase's
-- grants control either way. Left as-is, matching every other
-- trigger-only function in this project (enforce_pseudo_cooldown,
-- set_deadline_acceptation, etc.), none of which revoke EXECUTE either.

revoke all on function process_transaction_deadlines() from public;
grant execute on function process_transaction_deadlines() to service_role;

revoke all on function close_expired_campagnes() from public;
grant execute on function close_expired_campagnes() to service_role;

revoke all on function set_admin_status(uuid, boolean) from public;
grant execute on function set_admin_status(uuid, boolean) to authenticated;

revoke all on function mark_remboursement_manuel_traite(uuid) from public;
grant execute on function mark_remboursement_manuel_traite(uuid) to authenticated;
