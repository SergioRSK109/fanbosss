-- Automatic moderation of publications, via the Claude API (Anthropic),
-- which can analyze text and image(s) in the same call -- no second
-- provider needed. Two levels only, never a single one, mirroring what
-- Meta's and the OSCE/UN's own post-mortems on over-automated moderation
-- settled on (see CLAUDE.md for the full rationale):
--   - a clear, severe violation (explicit sexual content above all --
--     the hardest line in the CGU, article 8.1) blocks the publication
--     from ever being created at all, so there is never a window where
--     the content exists even briefly;
--   - anything merely ambiguous is published normally and automatically
--     flagged into the existing "Publications signalées" admin queue
--     (migration 0030) for a human to decide -- never auto-masked.
-- Video is handled by extracting 2-3 key frames client-side
-- (src/lib/videoDuration.ts#extractVideoFrames) and sending only those
-- JPEGs, exactly like a still image -- this codebase never processes
-- video server-side at all (no ffmpeg in this deployment target, same
-- reasoning as the pre-existing duration cap).

-- ---------------------------------------------------------------------
-- 1. Schema: reports.reporter_id becomes nullable, plus a `signalement_automatique`
--    type, so an automatic flag can be recorded honestly -- NULL means
--    exactly "no real user reported this," which is more honest than
--    attributing it to a fictional system account or to an admin who
--    did nothing. Extends the existing `reports` table rather than
--    adding a new one, same "one operational queue, not two" reasoning
--    migration 0030 already used for publication_id.
-- ---------------------------------------------------------------------

alter table reports alter column reporter_id drop not null;

alter table reports add constraint reports_reporter_ou_automatique
  check (reporter_id is not null or type = 'signalement_automatique');

-- Real constraint name confirmed by reading migration 0001 before
-- assuming it (Postgres's own default inline-CHECK naming,
-- `<table>_<column>_check`) -- same "verify before dropping" discipline
-- as every other constraint rename in this project.
alter table reports drop constraint reports_type_check;
alter table reports add constraint reports_type_check
  check (type in ('signalement', 'blocage', 'signalement_automatique'));

-- ---------------------------------------------------------------------
-- 2. signaler_publication_automatique() -- a private, non-SECURITY-DEFINER
--    helper, never granted to anyone, callable only from inside another
--    already-elevated SECURITY DEFINER function's execution context.
--    Same exact "propagation de propriété" mechanism as
--    appliquer_statut_compte() (migration 0052): a plain (invoker-rights)
--    function called from inside publier_message() (SECURITY DEFINER,
--    owned by the migration role that bypasses RLS in a real Supabase
--    project) runs under that same elevated context for the duration of
--    the call, with no separate grant needed -- and none is given here.
--
--    This is also why a direct authenticated REST insert into `reports`
--    with reporter_id = null can never fake an automatic signalement on
--    its own even without this function existing at all:
--    reports_insert_own's RLS check (`reporter_id = auth.uid()`) is
--    never satisfied when reporter_id is null (`null = auth.uid()` is
--    never TRUE) -- this function's complete lack of any grant is what
--    additionally makes sure no authenticated caller can even attempt to
--    route around that by calling it directly, same defense-in-depth
--    discipline as everywhere else in this project.
-- ---------------------------------------------------------------------

create function signaler_publication_automatique(p_publication_id uuid, p_raison text)
returns void
language plpgsql
as $$
declare
  v_auteur_id uuid;
begin
  select auteur_id into v_auteur_id from publications where id = p_publication_id;

  if v_auteur_id is null then
    raise exception 'publication not found';
  end if;

  insert into reports (reporter_id, reported_user_id, type, raison, publication_id, statut)
  values (null, v_auteur_id, 'signalement_automatique', p_raison, p_publication_id, 'en_attente');
end;
$$;

revoke all on function signaler_publication_automatique(uuid, text) from public;

-- ---------------------------------------------------------------------
-- 3. publier_message() gains a 6th, trailing-default parameter.
--
--    A real bug caught empirically before it shipped, the same
--    "reproduce before trusting" discipline this file has followed
--    since the pseudo-cooldown/0020 bugs: a plain `create or replace
--    function publier_message(...)` with a *different* parameter list
--    does NOT replace the existing 5-arg function the way every comment
--    in this codebase's history casually says a same-arity redefinition
--    does -- Postgres treats a different arity as a distinct overload,
--    so the old 5-arg version stayed callable side by side with the new
--    6-arg one, and a 3-positional-argument call (used throughout this
--    very checklist) became genuinely ambiguous between the two
--    ("function publier_message(unknown, unknown, unknown) is not
--    unique"). Fixed the same way this project has always handled a
--    real arity change to a function's signature (0031's
--    reposter_publication -> 0032's toggler_repost_publication is the
--    closest precedent): create the new 6-arg function fresh (`create or
--    replace` here still applies cleanly since no exact 6-arg match
--    exists yet), immediately re-state its `revoke all ... from public`
--    + `grant execute ... to authenticated` explicitly -- a fresh
--    signature carries no grant at all until this is done, PUBLIC gets
--    a default EXECUTE grant on any newly-created function otherwise
--    (the exact class of gap migration 0020 first found) -- and only
--    then drop the old 5-arg signature by its exact name+types. No
--    overload is kept -- this project doesn't carry backwards-
--    compatibility shims. The one caller (`POST /api/publications`) and
--    every SQL-checklist call site are unaffected either way, since none
--    of them relied on the dropped 5-arg signature surviving alongside
--    the new one.
-- ---------------------------------------------------------------------

-- Publishing and the automatic signalement happen atomically, in the
-- same statement/transaction -- deliberately, not as two separate steps
-- from the client/route layer: the brief's own flow ("publier
-- normalement via publier_message(), puis appeler
-- signaler_publication_automatique()") is satisfied at the observable
-- behavior level this way with no risk of a partial state (a
-- published-but-never-flagged ambiguous post if a second, separate RPC
-- call happened to fail after the first succeeded). The caller (the
-- /api/publications route) decides whether to pass a non-null raison
-- based on the *already-completed* moderation call it made beforehand
-- (POST /api/publications/moderer) -- publier_message() itself never
-- talks to the moderation API.

create or replace function publier_message(
  p_contenu text default null,
  p_image_r2_key text default null,
  p_visibilite text default 'public',
  p_autorise_repost text default 'tous',
  p_video_r2_key text default null,
  p_signalement_automatique_raison text default null
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

  -- Whitespace-only contenu is treated as "no text", same as an
  -- omitted/null one -- never stored verbatim as a blank-looking string
  -- when an image/video is what's actually carrying the post. This also
  -- keeps publications_contenu_coherent's own "1-2000 chars" bound
  -- meaningful: char_length('   ') is 3, which would otherwise pass that
  -- CHECK while still reading as empty to a viewer.
  if p_contenu is not null and char_length(trim(p_contenu)) = 0 then
    p_contenu := null;
  end if;

  -- The actual fix: reject only when text AND image AND video are ALL
  -- absent -- not contenu specifically. An image/video alone is now a
  -- complete, valid publication.
  if p_contenu is null and p_image_r2_key is null and p_video_r2_key is null then
    raise exception 'contenu, image_r2_key ou video_r2_key requis';
  end if;
  if p_contenu is not null and char_length(p_contenu) > 2000 then
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

  insert into publications (auteur_id, type, contenu, image_r2_key, video_r2_key, visibilite, autorise_repost)
  values (v_user_id, v_type, p_contenu, p_image_r2_key, p_video_r2_key, v_visibilite, v_autorise_repost)
  returning publications.id, publications.created_at into v_new_id, v_created_at;

  if p_signalement_automatique_raison is not null then
    perform signaler_publication_automatique(v_new_id, p_signalement_automatique_raison);
  end if;

  return query select v_new_id, v_type, v_visibilite, v_created_at;
end;
$$;

revoke all on function publier_message(text, text, text, text, text, text) from public;
grant execute on function publier_message(text, text, text, text, text, text) to authenticated;

drop function if exists publier_message(text, text, text, text, text);
