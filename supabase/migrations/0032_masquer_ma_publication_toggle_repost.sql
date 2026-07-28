-- Follow-up to Lot 5c (migration 0031): a créateur can hide their own
-- publication, the "..." menu shows different options depending on
-- whether the viewer authored the row being looked at, and reposting
-- becomes a real toggle (repost again to undo it) instead of a one-way
-- action.

-- ---------------------------------------------------------------------
-- 1. masquer_ma_publication() -- self-only, one-way (mask only, never
-- unmask). Deliberately no boolean parameter, unlike the admin-only
-- masquer_publication() (migration 0030): a créateur can pull their own
-- post down, but can never bring it back up themselves -- only an admin
-- can reverse that via the existing masquer_publication(), so a créateur
-- can't use "unhide" as a way to route around a moderation decision made
-- against them. Same SECURITY DEFINER + auth.uid()-null-check +
-- revoke/grant discipline as every write RPC since migration 0020.
-- ---------------------------------------------------------------------
create or replace function masquer_ma_publication(p_publication_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_auteur_id uuid;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select publications.auteur_id into v_auteur_id
    from publications where publications.id = p_publication_id;

  if v_auteur_id is null then
    raise exception 'publication not found';
  end if;

  if v_auteur_id != v_user_id then
    raise exception 'not authorized: you can only hide your own publications';
  end if;

  update publications set masque = true where id = p_publication_id;
end;
$$;

revoke all on function masquer_ma_publication(uuid) from public;
grant execute on function masquer_ma_publication(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2. reposter_publication() -> toggler_repost_publication() -- renamed
-- for consistency with toggler_like_publication()/toggler_mute_createur()
-- (p_publication_id is always the ORIGINAL's id, never the repost's, same
-- as the old function). The 1-arg signature is dropped outright and
-- recreated under the new name rather than kept as an alias -- this
-- project doesn't carry backwards-compatibility shims (see AGENTS.md),
-- and the one caller (POST /api/publications/[id]/repost) is updated in
-- the same change.
--
-- Toggle-off is a real DELETE, not a masque flip -- deliberately safe
-- here in a way it would NOT be for an original post: reposting a repost
-- is already rejected (both by this function's own check below and by
-- publications_contenu_coherent's shape), so a repost can never itself be
-- the target of another row's repost_de_id -- nothing ever references a
-- repost, so no FK can block deleting it. A repost also never carries its
-- own contenu/image_r2_key (publications_contenu_coherent requires both
-- null whenever repost_de_id is set), so there is nothing on R2 to clean
-- up either. Deleting it is a genuine reversal, not a moderation action --
-- masquer_ma_publication() above is the "hide but keep a record" tool for
-- a créateur's own original content; this is closer to "never happened".
--
-- The toggle-off branch is checked BEFORE the target's own
-- masked/visibilite/autorise_repost gates: those only matter when
-- CREATING a new repost. Undoing an existing repost must keep working
-- even if the original was masked or its author flipped autorise_repost
-- to 'personne' afterward -- there is no reason to trap a créateur into
-- a repost they can no longer remove. The "target is itself a repost"
-- check stays unconditional (checked first, applies to both directions)
-- since a repost of a repost could never have been created in the first
-- place, on either path.
create or replace function toggler_repost_publication(p_publication_id uuid)
returns table (reposted boolean, id uuid, type text, created_at timestamptz)
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
  v_existing_repost_id uuid;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select est_admin, createur_verifie into v_est_admin, v_createur_verifie
    from users where users.id = v_user_id;

  if not coalesce(v_est_admin, false) and not coalesce(v_createur_verifie, false) then
    raise exception 'not authorized: verified créateurs or admins only';
  end if;

  -- Table-qualified throughout: this function's OUT parameters (reposted,
  -- id, type, created_at) shadow plain column references the same way
  -- documented on reposter_publication() before it (0031) and
  -- creer_demande_verification() (0023).
  select publications.id, publications.auteur_id, publications.visibilite,
         publications.autorise_repost, publications.masque, publications.repost_de_id
    into v_target
    from publications where publications.id = p_publication_id;

  if v_target.id is null then
    raise exception 'publication not found';
  end if;

  if v_target.repost_de_id is not null then
    raise exception 'cannot repost a repost';
  end if;

  select publications.id into v_existing_repost_id
    from publications
    where publications.auteur_id = v_user_id and publications.repost_de_id = p_publication_id;

  if v_existing_repost_id is not null then
    delete from publications where publications.id = v_existing_repost_id;
    return query select false, v_existing_repost_id, null::text, null::timestamptz;
    return;
  end if;

  -- First-time repost only, from here on -- every check the original
  -- reposter_publication() had still applies.
  if v_target.masque then
    raise exception 'cannot repost a hidden publication';
  end if;

  if v_target.visibilite != 'public' then
    raise exception 'cannot repost a non-public publication';
  end if;

  if v_target.autorise_repost != 'tous' then
    raise exception 'repost not allowed by the author';
  end if;

  select count(*) into v_recent_count
    from publications
    where publications.auteur_id = v_user_id
      and publications.created_at > now() - interval '24 hours';

  if v_recent_count >= 10 then
    raise exception 'rate limit exceeded: max 10 publications per 24h';
  end if;

  if coalesce(v_est_admin, false) then
    v_type := 'annonce_fanboss';
  else
    v_type := 'createur';
  end if;

  insert into publications (auteur_id, type, contenu, repost_de_id, visibilite)
  values (v_user_id, v_type, null, p_publication_id, 'public')
  returning publications.id, publications.created_at into v_new_id, v_created_at;

  return query select true, v_new_id, v_type, v_created_at;
end;
$$;

revoke all on function toggler_repost_publication(uuid) from public;
grant execute on function toggler_repost_publication(uuid) to authenticated;

drop function if exists reposter_publication(uuid);
