-- Lot 5a: publications (créateur posts + FanBoss announcements), with
-- visibility gating (public vs soutiens-only) and a global /home feed.
-- Lot 5b (moderation of the `masque` flag) is a follow-up, not built here
-- -- see CLAUDE.md.

create table publications (
  id uuid primary key default gen_random_uuid(),
  auteur_id uuid not null references users(id),
  type text not null check (type in ('createur', 'annonce_fanboss')),
  contenu text not null check (char_length(contenu) between 1 and 2000),
  image_r2_key text,
  visibilite text not null default 'public' check (visibilite in ('public', 'soutiens')),
  masque boolean not null default false,
  created_at timestamptz not null default now()
);
create index idx_publications_auteur_id on publications(auteur_id, created_at desc);
create index idx_publications_created_at on publications(created_at desc);

alter table publications enable row level security;

-- Self-only direct-table reads (a créateur's own rows, regardless of
-- masque/visibilite) -- same "self-only by default" shape as every other
-- user-owned table in this project. Public reads go through the views
-- below instead. No insert/update policy for authenticated at all: every
-- write goes through publier_message() below, same "state machine only
-- via a vetted RPC" pattern as transactions/demandes_verification.
create policy publications_select_own on publications
  for select using (auteur_id = auth.uid());

-- Given exactly as specified -- deliberately plain invoker-rights (NOT
-- security definer), so a direct call by an authenticated caller stays
-- scoped by transactions' own RLS (fan_id = auth.uid() or createur_id =
-- auth.uid()): correct and safe for a fan checking their OWN support
-- relationship, and conservatively `false` (never a leak) for asking
-- about someone else's. Empirically confirmed (throwaway DB, not
-- assumed) that this plain-function shape does NOT work if called from
-- inside a public view instead -- see peut_voir_publication_complete()
-- below for why that needs a different (security definer) shape.
create or replace function soutient_createur(p_fan_id uuid, p_createur_id uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from transactions
    where fan_id = p_fan_id and createur_id = p_createur_id and statut = 'livree'
  );
$$;

-- The visibility predicate the public views below need, as its own
-- function so the same logic isn't duplicated across contenu/
-- image_r2_key/contenu_complet in the view's SELECT list.
--
-- MUST be security definer, and deliberately does not raise for a NULL
-- auth.uid() -- both unlike every other SECURITY DEFINER RPC in this
-- codebase, for reasons worth spelling out since they break the usual
-- pattern on purpose:
--
-- 1. Verified empirically (throwaway DB, not assumed) before choosing
--    this shape: a plain (non-security-definer) function called from
--    inside a view does NOT inherit the view owner's RLS-bypass the way
--    a table referenced directly in the view's own FROM-list does --
--    Postgres evaluates that function's internal query under the ACTUAL
--    querying role's privileges, not the view owner's. A first attempt
--    at this (calling soutient_createur() directly from the view) came
--    back `false` for every row regardless of the real answer -- wrong,
--    but silently so, exactly the kind of bug this project's "reproduce
--    before trusting a non-obvious mechanism" discipline exists to catch
--    before it ships. Marking THIS function security definer instead
--    fixes it: a security definer function's execution context (and
--    that of anything it calls internally, confirmed the same way) runs
--    as the function owner, the same bypass mechanism `classement_volume`
--    etc. already rely on for the tables they reference directly.
-- 2. This function is a read-path row-shaping helper embedded in a
--    PUBLIC view (profiles are visitable while logged out), not a
--    caller-invoked action -- an anonymous visitor legitimately needs a
--    real (non-erroring) answer here, which is always "show the teaser".
--    `coalesce(..., false)` at the end is not decorative: caught
--    empirically (throwaway DB) that without it, a NULL auth.uid()
--    makes `auth.uid() = p_auteur_id` evaluate to SQL NULL rather than
--    false, and NULL OR false is itself NULL (three-valued logic) --
--    the CASE WHEN in the view below happens to still treat a NULL
--    condition as "not true" (so contenu/image_r2_key still correctly
--    end up null), but `contenu_complet` -- read directly as this
--    function's raw return value, not through a CASE WHEN -- would then
--    surface as SQL NULL instead of a clean `false`, breaking the "an
--    explicit boolean flag, never inferred" guarantee this column is
--    supposed to give callers. EXECUTE is granted to anon as well as
--    authenticated
--    below for exactly this reason -- the one deliberate exception to
--    this project's usual "never grant a SECURITY DEFINER function to
--    anon" rule (migrations 0020/0021), safe here because the function
--    takes no fan-id parameter at all (always auth.uid() internally, per
--    point 3), so there is no way to use it to ask about anyone else's
--    relationship.
-- 3. No target-fan parameter, same shape as mes_progres_classement()/
--    creer_demande_verification(): reads auth.uid() internally, so a
--    caller can only ever ask "would I see this one full", never
--    "would fan X see this one full".
create or replace function peut_voir_publication_complete(p_auteur_id uuid, p_visibilite text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    p_visibilite = 'public'
      or auth.uid() = p_auteur_id
      or (auth.uid() is not null and soutient_createur(auth.uid(), p_auteur_id)),
    false
  );
$$;

revoke all on function peut_voir_publication_complete(uuid, text) from public;
grant execute on function peut_voir_publication_complete(uuid, text) to authenticated, anon;

-- The server-side access layer (the actual point of this lot): every
-- caller reading through this view gets either the full row or a
-- minimal teaser, decided per-row, server-side -- never both, and never
-- decided by the client. `contenu_complet` is an explicit boolean flag
-- rather than something the app has to infer from nullability: `contenu`
-- can never be legitimately null on a real row (the table's own CHECK
-- requires 1-2000 chars), so nulling it out is unambiguous evidence of
-- a teaser, but an explicit flag is clearer to consume than "null means
-- locked" and avoids ever having to guess. Excludes masque=true rows
-- entirely (not even a teaser) -- Lot 5b's moderation flag, already
-- effective even before that lot builds the UI to set it.
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
    peut_voir_publication_complete(p.auteur_id, p.visibilite) as contenu_complet
  from publications p
  where p.masque = false;

grant select on public.publications_visibles to authenticated, anon;

-- /home's global feed: every créateur-authored publication scoped to
-- créateurs who are CURRENTLY verified (not frozen at post-time -- same
-- "always compute live" principle as campagnes_montant_collecte/
-- nom_affichage conflict detection), plus every FanBoss announcement
-- regardless of the poster's own createur_verifie (an admin's own
-- verification status is irrelevant to whether their announcement is a
-- real FanBoss announcement -- `type = 'annonce_fanboss'` already means
-- that on its own, only ever settable by publier_message() itself, never
-- client-chosen). A créateur's own /[handle] profile page reads
-- publications_visibles directly instead (filtered by auteur_id, no
-- verification filter) -- so an unverified créateur's past posts stay
-- visible on their own profile even though they've dropped out of the
-- global feed. Deliberate asymmetry, not an oversight -- see CLAUDE.md.
create or replace view public.publications_accueil as
  select v.*
  from publications_visibles v
  join users u on u.id = v.auteur_id
  where u.createur_verifie = true or v.type = 'annonce_fanboss';

grant select on public.publications_accueil to authenticated, anon;

-- Creates a publication: type and (for admin posts) visibilite are both
-- decided server-side, never trusted from the client, same "the DB is
-- the real guarantee" discipline as the whatsapp price floor/age gate.
-- Rate-limited to 10 per rolling 24h window, applied uniformly (no admin
-- exception) -- a spam flood is a spam flood regardless of who's posting.
-- Only a créateur_verifie or an admin may call this at all (re-checked
-- here even though the UI composer is already gated the same way, per
-- this project's "never trust the client alone" rule) -- an admin posts
-- as `annonce_fanboss` (forced `visibilite = 'public'`, a FanBoss
-- announcement makes no sense soutiens-only), everyone else posts as
-- `createur`. If a caller is somehow both (an admin who's also a
-- verified créateur), admin wins -- posting as an admin is a platform
-- announcement, not a personal créateur update.
create or replace function publier_message(
  p_contenu text,
  p_image_r2_key text default null,
  p_visibilite text default 'public'
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

  -- Table-qualified: this function's OUT parameters (id, type, visibilite,
  -- created_at) are also in scope as plain PL/pgSQL variable names here,
  -- and an unqualified `id`/`created_at` was found (empirically, not
  -- assumed) to raise "column reference is ambiguous" against the OUT
  -- parameter instead of resolving to the table column -- the exact same
  -- pitfall already documented on creer_demande_verification (migration
  -- 0023).
  select est_admin, createur_verifie into v_est_admin, v_createur_verifie
    from users where users.id = v_user_id;

  if not coalesce(v_est_admin, false) and not coalesce(v_createur_verifie, false) then
    raise exception 'not authorized: verified créateurs or admins only';
  end if;

  if coalesce(v_est_admin, false) then
    v_type := 'annonce_fanboss';
    v_visibilite := 'public';
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

  insert into publications (auteur_id, type, contenu, image_r2_key, visibilite)
  values (v_user_id, v_type, p_contenu, p_image_r2_key, v_visibilite)
  returning publications.id, publications.created_at into v_new_id, v_created_at;

  return query select v_new_id, v_type, v_visibilite, v_created_at;
end;
$$;

revoke all on function publier_message(text, text, text) from public;
grant execute on function publier_message(text, text, text) to authenticated;

-- New top-level route (/home) -- keep the reserved-pseudo list in sync,
-- same discipline as every previous route addition (offres in 0028,
-- finance in 0027, ...).
alter table users drop constraint users_pseudo_not_reserved;
alter table users add constraint users_pseudo_not_reserved
  check (
    pseudo is null or lower(pseudo) not in (
      'dashboard', 'signup', 'login', 'api', 'auth',
      'createur', 'mes-transactions', 'paiement', 'parametres', 'explorer',
      'mot-de-passe-oublie', 'reinitialiser-mot-de-passe', 'admin', 'classement',
      'finance', 'offres', 'home'
    )
  );
