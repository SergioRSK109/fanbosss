-- Lot 5b: moderation for Lot 5a's publications -- a fan/créateur can
-- flag a publication, and an admin can hide it (or reject the flag).
-- Lot 5c (likes) is the next step after this one, not started here.

-- Extends the existing reports table rather than adding a new one, per
-- explicit instruction -- nullable, so every existing (WhatsApp-adjacent)
-- report row is untouched; the same admin worklist mechanism now also
-- covers a report that's about a specific publication.
alter table reports add column publication_id uuid references publications(id) on delete set null;

-- A fan/créateur flags a publication they can actually see in full --
-- "on ne signale pas un teaser qu'on n'a pas lu", per the brief.
-- security definer because it needs to read the target publication's
-- auteur_id/visibilite regardless of who owns it (publications_select_own
-- RLS is self-only), and re-uses peut_voir_publication_complete() exactly
-- as it already exists for the Lot 5a visibility layer -- no duplicated
-- eligibility logic. Same "auth.uid() is null -> raise" + revoke-from-
-- public/grant-to-authenticated discipline as every write RPC since
-- migration 0020.
create or replace function signaler_publication(p_publication_id uuid, p_raison text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_publication record;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select id, auteur_id, visibilite into v_publication
    from publications where id = p_publication_id;

  if v_publication.id is null then
    raise exception 'publication not found';
  end if;

  if not peut_voir_publication_complete(v_publication.auteur_id, v_publication.visibilite) then
    raise exception 'cannot report a publication you cannot fully see';
  end if;

  insert into reports (reporter_id, reported_user_id, type, raison, publication_id, statut)
  values (auth.uid(), v_publication.auteur_id, 'signalement', p_raison, p_publication_id, 'en_attente');
end;
$$;

revoke all on function signaler_publication(uuid, text) from public;
grant execute on function signaler_publication(uuid, text) to authenticated;

-- Standalone moderation primitive -- just the masque flag, nothing else.
-- publications_visibles/publications_accueil (migration 0029) already
-- exclude masque=true rows entirely, so there is genuinely nothing else
-- to change on the display side once this flips -- exactly what Lot 5a
-- flagged as "already effective before Lot 5b builds any UI to set it".
-- Same admin-only shape as mark_remboursement_manuel_traite/
-- resoudre_litige/traiter_retrait: re-verifies est_admin internally,
-- revoke all from public + grant to authenticated only (never anon --
-- an admin action always requires a real session).
create or replace function masquer_publication(p_publication_id uuid, p_masque boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from users where id = auth.uid() and est_admin = true
  ) then
    raise exception 'not authorized';
  end if;

  if not exists (select 1 from publications where id = p_publication_id) then
    raise exception 'publication not found';
  end if;

  update publications set masque = p_masque where id = p_publication_id;
end;
$$;

revoke all on function masquer_publication(uuid, boolean) from public;
grant execute on function masquer_publication(uuid, boolean) to authenticated;

-- The admin action behind "Publications signalées" (below): resolves one
-- report, not the publication in isolation -- `reports` has no
-- traite_par/traite_at/note_admin columns (deliberately not added here,
-- see the schema note above: "juste une colonne en plus"), so this is
-- the only admin-only write path for a report's own `statut`.
-- `masquer` calls straight into the same UPDATE masquer_publication()
-- performs (not a nested call to that function -- the admin check would
-- just be redone for nothing, since we're already inside a
-- security-definer, already-verified-admin context here) and marks the
-- report `traite`; `rejeter` only ever touches the report, the
-- publication is left completely untouched -- reusing the exact
-- `statut != 'en_attente' -> already handled` re-entrancy guard every
-- other admin RPC in this project already has.
create or replace function traiter_signalement_publication(p_report_id uuid, p_decision text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report record;
begin
  if not exists (
    select 1 from users where id = auth.uid() and est_admin = true
  ) then
    raise exception 'not authorized';
  end if;

  if p_decision not in ('masquer', 'rejeter') then
    raise exception 'invalid decision: %', p_decision;
  end if;

  select id, publication_id, statut into v_report
    from reports where id = p_report_id;

  if v_report.id is null or v_report.publication_id is null or v_report.statut != 'en_attente' then
    raise exception 'report not found or already handled';
  end if;

  if p_decision = 'masquer' then
    update publications set masque = true where id = v_report.publication_id;
    update reports set statut = 'traite' where id = p_report_id;
  else
    update reports set statut = 'rejete' where id = p_report_id;
  end if;
end;
$$;

revoke all on function traiter_signalement_publication(uuid, text) from public;
grant execute on function traiter_signalement_publication(uuid, text) to authenticated;
