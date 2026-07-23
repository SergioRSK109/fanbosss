-- 1. Pseudo / public handle (fanboss.app/@pseudo).
-- Case-insensitive uniqueness needs a functional index (a plain UNIQUE
-- constraint on `pseudo` would be case-sensitive, allowing "Sergio" and
-- "sergio" to coexist). NULLs stay allowed and non-conflicting (a regular
-- btree unique index treats every NULL as distinct) -- setting a pseudo is
-- optional, done later in settings, not required at signup.
alter table users add column pseudo text;

alter table users add constraint users_pseudo_format
  check (pseudo is null or pseudo ~ '^[a-zA-Z0-9_]{3,20}$');

-- Reserved words: every top-level route segment the app currently uses.
-- Public profile URLs are always /@pseudo (see brief on the [handle]
-- route capturing the literal "@"), so this isn't strictly required for
-- routing correctness (a bare "/login" and "/@login" are different
-- segments to Next.js) -- kept anyway per explicit instruction, and
-- because a pseudo that shadows a real route name is confusing even if it
-- doesn't technically collide. Update this list if new top-level routes
-- are added.
alter table users add constraint users_pseudo_not_reserved
  check (
    pseudo is null or lower(pseudo) not in (
      'dashboard', 'signup', 'login', 'api', 'auth',
      'createur', 'mes-transactions', 'paiement', 'parametres'
    )
  );

create unique index users_pseudo_lower_unique_idx on users (lower(pseudo));

-- 2. Profile enrichment: bio, profile photo, social link (all genuinely
-- public content once set -- see brief point 4 discussion: R2 access for
-- the photo still goes through a presigned URL like everything else, just
-- with a longer expiry since it isn't sensitive, rather than exposing it
-- as a permanent public bucket URL).
alter table users add column bio text;
alter table users add constraint users_bio_max_length check (bio is null or length(bio) <= 500);
alter table users add column photo_r2_key text;
alter table users add column lien_reseau_social text;

-- Signup trigger now also collects bio + lien_reseau_social. Photo is
-- deliberately NOT collected here -- see
-- src/app/api/profil/photo-upload-url/route.ts for why it's
-- authenticated-only, post-signup.
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

  insert into public.users (id, telephone, pays, parrain_id, bio, lien_reseau_social)
  values (
    new.id,
    new.raw_user_meta_data->>'telephone',
    coalesce(new.raw_user_meta_data->>'pays', 'RDC'),
    v_parrain_id,
    new.raw_user_meta_data->>'bio',
    new.raw_user_meta_data->>'lien_reseau_social'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- 3. Classement (leaderboards), opt-in.
alter table users add column classement_public boolean not null default false;

-- 4. Notification badge bookkeeping: null means "never viewed" (every
-- pending demande counts as new).
alter table users add column dernier_vu_demandes_at timestamptz;

-- 5. Réactivité tracking: when did the créateur actually respond (accept
-- or refuse), as opposed to deadline_acceptation which is only the
-- deadline. Needed for the réactivité leaderboard; deliberately left null
-- by the deadline cron (process_transaction_deadlines) so a no-response
-- auto-refund is correctly excluded from anyone's average response time.
alter table transactions add column repondu_at timestamptz;

create or replace function accept_transaction(p_transaction_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx record;
  v_offre_type text;
begin
  select * into v_tx from transactions where id = p_transaction_id for update;

  if v_tx is null then
    raise exception 'transaction not found';
  end if;

  if v_tx.createur_id != auth.uid() then
    raise exception 'not authorized';
  end if;

  if v_tx.statut != 'en_attente' then
    raise exception 'transaction is not pending acceptance';
  end if;

  if v_tx.deadline_acceptation is not null and now() > v_tx.deadline_acceptation then
    raise exception 'acceptation deadline has passed';
  end if;

  select type into v_offre_type from offres where id = v_tx.offre_id;

  update transactions set statut = 'validee', repondu_at = now() where id = p_transaction_id;

  -- WhatsApp: l'acceptation EST la livraison (numéro révélé immédiatement).
  if v_offre_type = 'whatsapp' then
    update transactions set statut = 'livree' where id = p_transaction_id;
  end if;
end;
$$;

create or replace function refuse_transaction(p_transaction_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx record;
begin
  select * into v_tx from transactions where id = p_transaction_id for update;

  if v_tx is null then
    raise exception 'transaction not found';
  end if;

  if v_tx.createur_id != auth.uid() then
    raise exception 'not authorized';
  end if;

  if v_tx.statut != 'en_attente' then
    raise exception 'transaction is not pending acceptance';
  end if;

  update transactions set statut = 'remboursee', repondu_at = now() where id = p_transaction_id;
end;
$$;

-- 6. Public profile view: append the new public-facing columns at the end
-- (CREATE OR REPLACE VIEW can only add trailing columns, never reorder or
-- insert among existing ones).
create or replace view public.profils_publics as
  select id, pays, devise, date_creation, pseudo, bio, photo_r2_key, lien_reseau_social
  from users;

-- 7. Classement views: rank only, never the underlying count/average --
-- brief: "aucun montant en dollars affiché publiquement, seulement le
-- rang" -- interpreted strictly: don't expose the supporting numbers
-- either, only the position. All three are scoped to classement_public =
-- true and a rolling 30-day window; owned by the migration role
-- (bypassrls in a real Supabase project, same mechanism verified for
-- profils_publics/offres_publiques in migration 0006), so ranks are
-- readable without granting any access to the underlying users/
-- transactions tables.

create view public.classement_volume as
  select
    u.id as createur_id,
    rank() over (
      order by count(t.id) filter (
        where t.statut = 'livree' and t.created_at >= now() - interval '30 days'
      ) desc
    ) as rang
  from users u
  left join transactions t on t.createur_id = u.id
  where u.classement_public = true
  group by u.id;

grant select on public.classement_volume to authenticated, anon;

-- Only video/shoutout/whatsapp have a real human acceptation step; don/
-- contenu_debloque/evenement_live are auto-validated by the webhook and
-- say nothing about how responsive the créateur is.
create view public.classement_reactivite as
  select
    u.id as createur_id,
    rank() over (
      order by avg(
        extract(epoch from (t.repondu_at - t.created_at))
      ) filter (
        where t.repondu_at is not null
          and o.type in ('video', 'shoutout', 'whatsapp')
          and t.created_at >= now() - interval '30 days'
      ) asc nulls last
    ) as rang
  from users u
  left join transactions t on t.createur_id = u.id
  left join offres o on o.id = t.offre_id
  where u.classement_public = true
  group by u.id;

grant select on public.classement_reactivite to authenticated, anon;

-- "Nouveaux comptes qui montent vite": ranked among accounts created in
-- the last 30 days only, by their (necessarily also within-30-days)
-- delivered-transaction volume.
create view public.classement_progression as
  select
    u.id as createur_id,
    rank() over (
      order by count(t.id) filter (where t.statut = 'livree') desc
    ) as rang
  from users u
  left join transactions t on t.createur_id = u.id
  where u.classement_public = true
    and u.date_creation >= now() - interval '30 days'
  group by u.id;

grant select on public.classement_progression to authenticated, anon;
