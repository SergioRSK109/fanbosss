-- Video support for publications, additive alongside the existing image
-- support (migration 0029) -- never both on the same row.
alter table publications add column video_r2_key text;
alter table publications add constraint publications_media_exclusif
  check (image_r2_key is null or video_r2_key is null);

-- publier_message() gains a 5th parameter, p_video_r2_key, mirroring
-- p_image_r2_key exactly -- same insert, same server-side shape. The
-- publications_media_exclusif constraint above is the real guarantee
-- against a caller ever setting both; this function doesn't duplicate
-- that check itself, same "constraint is the real guarantee" discipline
-- as unique_offre_type_par_createur/idx_repost_unique elsewhere in this
-- project. The 4-arg signature is dropped outright, not kept as a second
-- overload -- same no-backwards-compatibility-shim discipline as every
-- earlier publier_message() signature change (migrations 0029 -> 0031).
drop function if exists publier_message(text, text, text, text);

create or replace function publier_message(
  p_contenu text,
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

  insert into publications (auteur_id, type, contenu, image_r2_key, video_r2_key, visibilite, autorise_repost)
  values (v_user_id, v_type, p_contenu, p_image_r2_key, p_video_r2_key, v_visibilite, v_autorise_repost)
  returning publications.id, publications.created_at into v_new_id, v_created_at;

  return query select v_new_id, v_type, v_visibilite, v_created_at;
end;
$$;

revoke all on function publier_message(text, text, text, text, text) from public;
grant execute on function publier_message(text, text, text, text, text) to authenticated;

-- publications_visibles: video_r2_key gets exactly the same teaser
-- treatment as image_r2_key (never sent to a viewer who can't see the
-- full content) -- appended as a trailing column only (CREATE OR REPLACE
-- VIEW can add new trailing columns but cannot reorder/insert among
-- existing ones, see CLAUDE.md), every other column/clause here is
-- otherwise byte-identical to migration 0031's definition.
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
    (select count(*) from publications rc where rc.repost_de_id = p.id)::int as reposts_count,
    exists (
      select 1 from publications_likes pl
      where pl.publication_id = p.id and pl.fan_id = auth.uid()
    ) as viewer_a_aime,
    exists (
      select 1 from publications_partages pp
      where pp.publication_id = p.id and pp.fan_id = auth.uid()
    ) as viewer_a_partage,
    exists (
      select 1 from publications rp
      where rp.repost_de_id = p.id and rp.auteur_id = auth.uid()
    ) as viewer_a_reposte,
    case when peut_voir_publication_complete(p.auteur_id, p.visibilite)
      then p.video_r2_key else null end as video_r2_key
  from publications p
  left join publications orig on orig.id = p.repost_de_id
  where p.masque = false
    and (p.repost_de_id is null or orig.masque = false);

grant select on public.publications_visibles to authenticated, anon;

-- publications_accueil's own SQL text is unchanged (still `select v.*`),
-- but it must still be recreated here: a view's `*` is expanded into an
-- explicit column list at CREATE time, not re-resolved automatically
-- when the underlying view gains a column later -- the same reason
-- migration 0031 recreated this view even though its own text didn't
-- change either.
create or replace view public.publications_accueil as
  select v.*
  from publications_visibles v
  join users u on u.id = v.auteur_id
  where (u.createur_verifie = true or v.type = 'annonce_fanboss')
    and not exists (
      select 1 from publications_mutes pm
      where pm.fan_id = auth.uid() and pm.createur_muet_id = v.auteur_id
    );

-- `authenticated` only, deliberately NOT `anon` -- migration 0033 revoked
-- anon's access to this specific view (/home now requires a session), and
-- `create or replace view` does not itself reset any grant, but recreating
-- the view is exactly the kind of change that's easy to accidentally
-- re-grant on if copied verbatim from an older migration; called out
-- explicitly here, and re-verified below, so it doesn't regress silently.
grant select on public.publications_accueil to authenticated;
