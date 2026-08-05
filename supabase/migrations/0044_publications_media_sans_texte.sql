-- Real, confirmed bug: a créateur could never publish a photo or video
-- with no caption at all -- publications_contenu_coherent (migration
-- 0031) unconditionally required 1-2000 chars of contenu for any
-- non-repost row, regardless of whether an image/video was attached, and
-- publier_message() enforced the exact same all-or-nothing rule on top.
-- New rule for a plain (non-repost) publication: at least one of
-- contenu/image_r2_key/video_r2_key, not contenu specifically. A repost
-- is untouched -- still requires repost_de_id set and contenu null,
-- exactly as migration 0031 defined it.
alter table publications drop constraint publications_contenu_coherent;
alter table publications add constraint publications_contenu_coherent
  check (
    (repost_de_id is not null and contenu is null)
    or (repost_de_id is null
        and (contenu is null or char_length(contenu) between 1 and 2000)
        and (contenu is not null or image_r2_key is not null or video_r2_key is not null))
  );

-- create or replace with an identical signature (same 5 text params,
-- same order) -- leaves the existing `authenticated`-only EXECUTE grant
-- untouched, same precedent as every earlier redefinition of this
-- function (0031 -> 0037 -> here). p_contenu now defaults to null,
-- matching p_image_r2_key/p_video_r2_key's own shape -- a direct RPC
-- call (SQL tests, a future API caller) can now omit it entirely for an
-- image/video-only post instead of being forced to pass an explicit
-- null.
create or replace function publier_message(
  p_contenu text default null,
  p_image_r2_key text default null,
  p_visibilite text default 'public',
  p_autorise_repost text default 'tous',
  p_video_r2_key text default null
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

  return query select v_new_id, v_type, v_visibilite, v_created_at;
end;
$$;
