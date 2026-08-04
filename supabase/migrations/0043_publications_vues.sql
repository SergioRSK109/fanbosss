-- View counter on publications video (Explorer grid overlay). Same
-- "raw counter, no per-visitor dedup table" reasoning already used for
-- likes/partages (migrations 0031) -- a view is not a meaningful
-- per-account action worth a uniqueness guarantee, just a rough public
-- metric. anon can increment it directly (a logged-out visitor scrolling
-- Explorer still watches videos and should still count), same shape as
-- every other public, non-sensitive counter in this project.
alter table publications add column vues_count integer not null default 0 check (vues_count >= 0);

-- video_r2_key is not null guard: a view only ever makes sense for a
-- publication that actually has a video -- silently no-opping (not
-- raising) for anything else keeps this callable without the client
-- needing to know in advance whether a given id is a video post, and
-- matches the "never trust the client, the DB is the real guarantee"
-- posture this project already applies elsewhere (the WHERE clause is
-- the guarantee, not a defensive check in the calling route).
create or replace function incrementer_vue_publication(p_publication_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update publications set vues_count = vues_count + 1
    where id = p_publication_id and video_r2_key is not null;
end;
$$;

revoke all on function incrementer_vue_publication(uuid) from public;
grant execute on function incrementer_vue_publication(uuid) to authenticated, anon;

-- publications_visibles: vues_count gets no teaser treatment at all
-- (unlike contenu/image_r2_key/video_r2_key) -- a view count is never
-- sensitive, same reasoning as likes_count/partages_count/reposts_count
-- just above it. Appended as a trailing column only (CREATE OR REPLACE
-- VIEW can add new trailing columns but cannot reorder/insert among
-- existing ones, see CLAUDE.md); every other column/clause here is
-- otherwise byte-identical to migration 0037's definition.
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
      then p.video_r2_key else null end as video_r2_key,
    p.vues_count
  from publications p
  left join publications orig on orig.id = p.repost_de_id
  where p.masque = false
    and (p.repost_de_id is null or orig.masque = false);

grant select on public.publications_visibles to authenticated, anon;

-- publications_accueil's own SQL text is unchanged (still `select v.*`),
-- but it must still be recreated here: a view's `*` is expanded into an
-- explicit column list at CREATE time, not re-resolved automatically
-- when the underlying view gains a column later -- same reason migration
-- 0037 recreated this view (and 0031 before it) even though its own text
-- never changes.
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
-- anon's access to this specific view (/home requires a session); called
-- out explicitly again here (same trap migration 0037 already flagged)
-- so recreating this view never silently re-widens that grant.
grant select on public.publications_accueil to authenticated;

-- publications_explorables: same "select v.* needs recreating whenever
-- publications_visibles gains a column" reasoning as publications_accueil
-- above -- its own SQL text is unchanged too. `create or replace` (not
-- `create`, migration 0038's original statement) since the view already
-- exists.
create or replace view public.publications_explorables as
  select v.*
  from publications_visibles v
  join users u on u.id = v.auteur_id
  where v.visibilite = 'public'
    and (u.createur_verifie = true or v.type = 'annonce_fanboss')
    and u.masque_exploration = false;

-- Public discovery surface, no auth required -- same grant shape as
-- migration 0038's original statement.
grant select on public.publications_explorables to authenticated, anon;
