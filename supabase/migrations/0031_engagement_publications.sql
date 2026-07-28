-- Lot 5c: engagement on publications (Lot 5a, migration 0029) -- likes,
-- reposts, share counts, and per-fan mute of a créateur. Lot 5b's
-- moderation (masque) is untouched by this migration except for one new
-- cascade rule: a repost of a since-masked original must disappear too,
-- not just a directly-masked row -- see the view comment below, the most
-- important single behavior in this lot.

-- ---------------------------------------------------------------------
-- 1. Schema -- given exactly as specified.
-- ---------------------------------------------------------------------

create table publications_likes (
  publication_id uuid not null references publications(id) on delete cascade,
  fan_id uuid not null references users(id),
  created_at timestamptz not null default now(),
  primary key (publication_id, fan_id)
);

create table publications_partages (
  publication_id uuid not null references publications(id) on delete cascade,
  fan_id uuid not null references users(id),
  created_at timestamptz not null default now(),
  primary key (publication_id, fan_id)
);

-- Mutes a créateur in the global feed only -- publications_visibles (a
-- créateur's own profile page) deliberately ignores this table, only
-- publications_accueil (/home) consults it. See CLAUDE.md for why this
-- asymmetry is intentional, not an oversight.
create table publications_mutes (
  fan_id uuid not null references users(id),
  createur_muet_id uuid not null references users(id),
  created_at timestamptz not null default now(),
  primary key (fan_id, createur_muet_id),
  check (fan_id != createur_muet_id)
);

-- Repost: chosen by the ORIGINAL's own author (autorise_repost), not the
-- reposter -- same "the author controls it" shape as visibilite itself.
-- repost_de_id has no ON DELETE clause (default RESTRICT/NO ACTION) --
-- this codebase has no publication-delete path at all, so a dangling
-- reference can never arise in practice; masking (not deleting) is the
-- only "remove a publication" mechanism that exists (Lot 5b).
alter table publications add column autorise_repost text
  not null default 'tous' check (autorise_repost in ('personne', 'tous'));
alter table publications add column repost_de_id uuid references publications(id);
alter table publications alter column contenu drop not null;
alter table publications add constraint publications_contenu_coherent
  check ((repost_de_id is null and char_length(contenu) between 1 and 2000)
      or (repost_de_id is not null and contenu is null));
-- The real guarantee against a double-repost by the same author -- the
-- explicit check inside reposter_publication() below exists only to give
-- a clean error message before ever hitting this constraint, same
-- "defense in depth, constraint is the real guarantee" discipline as
-- every other unique-shaped rule in this project (e.g.
-- unique_offre_type_par_createur).
create unique index idx_repost_unique on publications(auteur_id, repost_de_id) where repost_de_id is not null;

-- publications_likes/publications_partages/publications_mutes have no RLS
-- policy for authenticated at all -- same "state machine only via a
-- vetted RPC" shape as publications itself (migration 0029): every read a
-- caller needs (counts, "did I already like/share this", "who have I
-- muted") is served through the views/RPCs below, never a direct table
-- read, so there is nothing to gate with a self-only policy here.
alter table publications_likes enable row level security;
alter table publications_partages enable row level security;
alter table publications_mutes enable row level security;

-- ---------------------------------------------------------------------
-- 2. RPCs -- same discipline as every write RPC since migration 0020:
-- `auth.uid() is null` rejected explicitly, `revoke all ... from public`
-- + `grant execute ... to authenticated` only (never anon -- every one of
-- these four is a caller-specific action, unlike
-- peut_voir_publication_complete()'s deliberate anon exception).
-- ---------------------------------------------------------------------

-- Toggle: re-uses peut_voir_publication_complete() exactly as
-- signaler_publication() already does (migration 0030) -- "on ne peut
-- pas aimer un teaser qu'on n'a pas lu", same eligibility rule as
-- reporting. Returns the post-toggle state so the client never needs a
-- second round trip to learn the new count.
create or replace function toggler_like_publication(p_publication_id uuid)
returns table (liked boolean, likes_count int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_publication record;
  v_liked boolean;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select id, auteur_id, visibilite into v_publication
    from publications where id = p_publication_id;

  if v_publication.id is null then
    raise exception 'publication not found';
  end if;

  if not peut_voir_publication_complete(v_publication.auteur_id, v_publication.visibilite) then
    raise exception 'cannot like a publication you cannot fully see';
  end if;

  if exists (
    select 1 from publications_likes
    where publication_id = p_publication_id and fan_id = v_user_id
  ) then
    delete from publications_likes
      where publication_id = p_publication_id and fan_id = v_user_id;
    v_liked := false;
  else
    insert into publications_likes (publication_id, fan_id) values (p_publication_id, v_user_id);
    v_liked := true;
  end if;

  return query
    select v_liked, (select count(*)::int from publications_likes where publication_id = p_publication_id);
end;
$$;

revoke all on function toggler_like_publication(uuid) from public;
grant execute on function toggler_like_publication(uuid) to authenticated;

-- Reserved to verified créateurs + admins (same population as
-- publier_message() -- re-verified here independently, never trusting a
-- caller who merely passed publier_message()'s own check once). Every
-- rejection condition below is checked and reported individually, on
-- purpose, so both the SQL checklist and a real error message can tell
-- them apart -- see CLAUDE.md's "Litige resolution"/every other RPC in
-- this project for why that granularity matters.
--
-- The rate limit is deliberately the exact same query publier_message()
-- already runs (count of this auteur's own rows in the last 24h) --
-- since a repost is a normal row in the same `publications` table, this
-- single query already counts posts and reposts together with no special
-- casing needed. See CLAUDE.md for why this is a deliberate design
-- decision, not an oversight.
create or replace function reposter_publication(p_publication_id uuid)
returns table (id uuid, type text, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_est_admin boolean;
  v_createur_verifie boolean;
  v_type text;
  v_target record;
  v_recent_count int;
  v_new_id uuid;
  v_created_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select est_admin, createur_verifie into v_est_admin, v_createur_verifie
    from users where users.id = v_user_id;

  if not coalesce(v_est_admin, false) and not coalesce(v_createur_verifie, false) then
    raise exception 'not authorized: verified créateurs or admins only';
  end if;

  -- Table-qualified: this function's OUT parameters (id, type,
  -- created_at) are also in scope as plain PL/pgSQL variable names here,
  -- and an unqualified `id` was found (empirically, not assumed) to
  -- raise "column reference is ambiguous" against the OUT parameter
  -- instead of resolving to the table column -- the exact same pitfall
  -- already documented on creer_demande_verification (0023) and
  -- publier_message() (0029).
  select publications.id, publications.auteur_id, publications.visibilite,
         publications.autorise_repost, publications.masque, publications.repost_de_id
    into v_target
    from publications where publications.id = p_publication_id;

  if v_target.id is null then
    raise exception 'publication not found';
  end if;

  if v_target.masque then
    raise exception 'cannot repost a hidden publication';
  end if;

  if v_target.visibilite != 'public' then
    raise exception 'cannot repost a non-public publication';
  end if;

  if v_target.autorise_repost != 'tous' then
    raise exception 'repost not allowed by the author';
  end if;

  if v_target.repost_de_id is not null then
    raise exception 'cannot repost a repost';
  end if;

  if exists (
    select 1 from publications
    where publications.auteur_id = v_user_id and publications.repost_de_id = p_publication_id
  ) then
    raise exception 'already reposted this publication';
  end if;

  select count(*) into v_recent_count
    from publications
    where publications.auteur_id = v_user_id
      and publications.created_at > now() - interval '24 hours';

  if v_recent_count >= 10 then
    raise exception 'rate limit exceeded: max 10 publications per 24h';
  end if;

  -- Type auto-assigned exactly like publier_message() -- an admin's
  -- repost is a platform action (annonce_fanboss), a créateur's is a
  -- personal one (createur). visibilite is always forced to 'public',
  -- never inherited or chosen -- a restricted repost would be
  -- meaningless (its own eligibility already requires the target to be
  -- public in the first place).
  if coalesce(v_est_admin, false) then
    v_type := 'annonce_fanboss';
  else
    v_type := 'createur';
  end if;

  insert into publications (auteur_id, type, contenu, repost_de_id, visibilite)
  values (v_user_id, v_type, null, p_publication_id, 'public')
  returning publications.id, publications.created_at into v_new_id, v_created_at;

  return query select v_new_id, v_type, v_created_at;
end;
$$;

revoke all on function reposter_publication(uuid) from public;
grant execute on function reposter_publication(uuid) to authenticated;

-- Deliberately no visibility check at all -- sharing a link reveals
-- nothing beyond what the permalink page (/@pseudo/p/{id}) already shows
-- that exact same viewer; the real content gate is (and stays)
-- peut_voir_publication_complete(), applied wherever contenu/image_r2_key
-- are actually read, not here. Idempotent via `on conflict do nothing`
-- on the table's own primary key -- a second share by the same fan never
-- double-counts.
create or replace function partager_publication(p_publication_id uuid)
returns table (partages_count int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  if not exists (select 1 from publications where id = p_publication_id) then
    raise exception 'publication not found';
  end if;

  insert into publications_partages (publication_id, fan_id)
  values (p_publication_id, v_user_id)
  on conflict do nothing;

  return query
    select count(*)::int from publications_partages where publication_id = p_publication_id;
end;
$$;

revoke all on function partager_publication(uuid) from public;
grant execute on function partager_publication(uuid) to authenticated;

-- Toggle. The self-mute rejection here is a clean error message on top
-- of the table's own `check (fan_id != createur_muet_id)` -- same
-- "defense in depth, constraint is the real guarantee" shape as every
-- explicit RPC-level check backed by a DB constraint elsewhere in this
-- project.
create or replace function toggler_mute_createur(p_createur_id uuid)
returns table (muted boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_muted boolean;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  if p_createur_id = v_user_id then
    raise exception 'cannot mute yourself';
  end if;

  if exists (
    select 1 from publications_mutes
    where fan_id = v_user_id and createur_muet_id = p_createur_id
  ) then
    delete from publications_mutes
      where fan_id = v_user_id and createur_muet_id = p_createur_id;
    v_muted := false;
  else
    insert into publications_mutes (fan_id, createur_muet_id) values (v_user_id, p_createur_id);
    v_muted := true;
  end if;

  return query select v_muted;
end;
$$;

revoke all on function toggler_mute_createur(uuid) from public;
grant execute on function toggler_mute_createur(uuid) to authenticated;

-- publier_message() itself: gains a 4th parameter (p_autorise_repost),
-- forced to 'tous' for an admin's annonce_fanboss post -- same "server
-- decides for this type, never the client" rule already applied to
-- visibilite for that exact type (migration 0029). The 3-arg signature
-- is dropped outright rather than kept as a second overload -- this
-- project doesn't carry backwards-compatibility shims (see AGENTS.md/
-- CLAUDE.md's own engineering discipline), and the only caller
-- (POST /api/publications) is updated in the same change.
drop function if exists publier_message(text, text, text);

create or replace function publier_message(
  p_contenu text,
  p_image_r2_key text default null,
  p_visibilite text default 'public',
  p_autorise_repost text default 'tous'
)
returns table (id uuid, type text, visibilite text, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_est_admin boolean;
  v_createur_verifie boolean;
  v_type text;
  v_visibilite text := coalesce(p_visibilite, 'public');
  v_autorise_repost text := coalesce(p_autorise_repost, 'tous');
  v_recent_count int;
  v_new_id uuid;
  v_created_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  if p_contenu is null or char_length(trim(p_contenu)) = 0 then
    raise exception 'contenu is required';
  end if;
  if char_length(p_contenu) > 2000 then
    raise exception 'contenu exceeds 2000 characters';
  end if;

  if v_visibilite not in ('public', 'soutiens') then
    raise exception 'invalid visibilite';
  end if;

  if v_autorise_repost not in ('personne', 'tous') then
    raise exception 'invalid autorise_repost';
  end if;

  select est_admin, createur_verifie into v_est_admin, v_createur_verifie
    from users where users.id = v_user_id;

  if not coalesce(v_est_admin, false) and not coalesce(v_createur_verifie, false) then
    raise exception 'not authorized: verified créateurs or admins only';
  end if;

  if coalesce(v_est_admin, false) then
    v_type := 'annonce_fanboss';
    v_visibilite := 'public';
    v_autorise_repost := 'tous';
  else
    v_type := 'createur';
  end if;

  select count(*) into v_recent_count
    from publications
    where publications.auteur_id = v_user_id
      and publications.created_at > now() - interval '24 hours';

  if v_recent_count >= 10 then
    raise exception 'rate limit exceeded: max 10 publications per 24h';
  end if;

  insert into publications (auteur_id, type, contenu, image_r2_key, visibilite, autorise_repost)
  values (v_user_id, v_type, p_contenu, p_image_r2_key, v_visibilite, v_autorise_repost)
  returning publications.id, publications.created_at into v_new_id, v_created_at;

  return query select v_new_id, v_type, v_visibilite, v_created_at;
end;
$$;

revoke all on function publier_message(text, text, text, text) from public;
grant execute on function publier_message(text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Views -- publications_visibles/publications_accueil (migration
-- 0029) gain engagement counts/flags, plus the masking cascade for
-- reposts. Nothing about the teaser mechanism itself changes.
-- ---------------------------------------------------------------------

-- The most important behavior in this lot, verified empirically (see
-- checklist_2_3.sql) before trusting it, same "reproduce a non-obvious
-- Postgres mechanism before relying on it" discipline this project has
-- followed since the pseudo-cooldown/0020/publications-view bugs: a
-- repost's OWN masque flag is not the only thing that can make it
-- disappear -- a `left join` back to the referenced original (`orig`)
-- means a repost also vanishes the moment an admin masks the original
-- it points to, even though the repost row itself was never touched.
-- `orig` is null for a plain (non-repost) row, so
-- `p.repost_de_id is null or orig.masque = false` is true for every
-- ordinary post regardless of the join.
create or replace view public.publications_visibles as
  select
    p.id,
    p.auteur_id,
    p.type,
    case when peut_voir_publication_complete(p.auteur_id, p.visibilite)
      then p.contenu else null end as contenu,
    case when peut_voir_publication_complete(p.auteur_id, p.visibilite)
      then p.image_r2_key else null end as image_r2_key,
    p.visibilite,
    p.created_at,
    peut_voir_publication_complete(p.auteur_id, p.visibilite) as contenu_complet,
    p.repost_de_id,
    p.autorise_repost,
    (select count(*) from publications_likes pl where pl.publication_id = p.id)::int as likes_count,
    (select count(*) from publications_partages pp where pp.publication_id = p.id)::int as partages_count,
    -- Not explicitly listed in section 3 of the brief (only likes_count/
    -- partages_count/viewer_a_aime/viewer_a_partage are), but section 5's
    -- action-bar spec explicitly asks for a counter next to the repost
    -- button too -- same "count of rows referencing this publication"
    -- shape as the two counts above, just counting publications whose
    -- repost_de_id points back at this row instead of a dedicated table.
    (select count(*) from publications rc where rc.repost_de_id = p.id)::int as reposts_count,
    exists (
      select 1 from publications_likes pl
      where pl.publication_id = p.id and pl.fan_id = auth.uid()
    ) as viewer_a_aime,
    exists (
      select 1 from publications_partages pp
      where pp.publication_id = p.id and pp.fan_id = auth.uid()
    ) as viewer_a_partage,
    -- Backs the "already reposted by me" eligibility check the repost
    -- button itself needs client-side (section 5 of the brief) --
    -- reposter_publication() already rejects a double-repost server-side
    -- regardless, this is purely so the UI can hide/disable the button
    -- ahead of time instead of letting the caller find out from a
    -- rejected RPC call.
    exists (
      select 1 from publications rp
      where rp.repost_de_id = p.id and rp.auteur_id = auth.uid()
    ) as viewer_a_reposte
  from publications p
  left join publications orig on orig.id = p.repost_de_id
  where p.masque = false
    and (p.repost_de_id is null or orig.masque = false);

grant select on public.publications_visibles to authenticated, anon;

-- /home's global feed: unchanged verification-scoping logic (migration
-- 0029) plus one new filter, exclusive to this view -- a publication
-- (post OR repost, judged by ITS OWN auteur_id, i.e. the reposter for a
-- repost row) whose author the current viewer has muted is dropped here
-- only. publications_visibles (a créateur's own profile page) never
-- consults publications_mutes at all -- see CLAUDE.md for why muting is
-- deliberately asymmetric between the two surfaces. For anon (auth.uid()
-- is null), `pm.fan_id = auth.uid()` never matches any real row, so
-- `not exists(...)` is unconditionally true and this filter is a no-op,
-- exactly as it should be -- mutes are a per-fan setting an anonymous
-- visitor can never have set.
create or replace view public.publications_accueil as
  select v.*
  from publications_visibles v
  join users u on u.id = v.auteur_id
  where (u.createur_verifie = true or v.type = 'annonce_fanboss')
    and not exists (
      select 1 from publications_mutes pm
      where pm.fan_id = auth.uid() and pm.createur_muet_id = v.auteur_id
    );

grant select on public.publications_accueil to authenticated, anon;
