-- Lot 6a: in-app notifications -- schema + a single reusable insertion
-- helper, wired into every existing state-changing function that has a
-- real recipient. Given exactly as specified.

create table notifications (
  id uuid primary key default gen_random_uuid(),
  destinataire_id uuid not null references users(id),
  type text not null check (type in (
    'demande_recue', 'don_recu',
    'demande_acceptee', 'demande_refusee', 'video_livree',
    'confirmation_recue', 'contestation_recue',
    'litige_tranche_createur', 'litige_tranche_fan',
    'retrait_traite', 'retrait_refuse',
    'publication_aimee'
  )),
  transaction_id uuid references transactions(id),
  publication_id uuid references publications(id),
  acteur_id uuid references users(id),
  lu boolean not null default false,
  created_at timestamptz not null default now()
);
create index idx_notifications_destinataire on notifications(destinataire_id, lu, created_at desc);

-- Self-only read access, same default as every other user-owned table in
-- this project. No INSERT/UPDATE/DELETE policy for authenticated at all
-- -- every write goes through creer_notification()/
-- marquer_notifications_lues() below, same "state machine only via a
-- vetted RPC" shape as transactions/publications/demandes_verification.
alter table notifications enable row level security;
create policy notifications_select_own on notifications
  for select using (destinataire_id = auth.uid());

-- The one, single insertion path -- every call site below (and the
-- CinetPay webhook, for demande_recue/don_recu) calls this, never a raw
-- INSERT, so the shape of a notification row can never drift between
-- call sites. Deliberately has NO internal authorization check of its
-- own (unlike literally every other SECURITY DEFINER RPC in this
-- project) -- it's not meant to be called directly by a client at all,
-- only from inside another function that has *already* verified the
-- caller's own identity/relationship to the event, or from the
-- webhook's own trusted service-role context. See the grant below for
-- why this is safe.
create or replace function creer_notification(
  p_destinataire_id uuid, p_type text, p_transaction_id uuid default null,
  p_publication_id uuid default null, p_acteur_id uuid default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (destinataire_id, type, transaction_id, publication_id, acteur_id)
  values (p_destinataire_id, p_type, p_transaction_id, p_publication_id, p_acteur_id);
end;
$$;

-- Deliberately NOT granted to `authenticated`: this function takes an
-- arbitrary p_destinataire_id/p_acteur_id with no ownership check at
-- all, so a direct authenticated call would let anyone insert a fake
-- notification impersonating any acteur, for any recipient. Every real
-- call site below is either (a) a call from inside another SECURITY
-- DEFINER function owned by the same role -- which runs with that
-- owner's own privileges once inside, so it needs no separate grant of
-- its own, same as any role calling a function it owns -- or (b) the
-- CinetPay webhook, via the service-role client, for the one case
-- (transaction creation) that has no wrapping RPC to attach to.
-- Verified empirically (not assumed) that the internal, ownership-based
-- call path actually works with no `authenticated` grant at all -- see
-- CLAUDE.md.
revoke all on function creer_notification(uuid, text, uuid, uuid, uuid) from public;
grant execute on function creer_notification(uuid, text, uuid, uuid, uuid) to service_role;

-- Marks every one of the caller's own unread notifications as read in
-- one call -- this app's UX opens the bell's dropdown and immediately
-- marks everything read (see NotificationBell.tsx), rather than
-- supporting a per-notification "mark as read" RPC; clicking an
-- individual row only ever navigates, since by the time it's clickable
-- the whole batch was already marked read when the panel opened.
create or replace function marquer_notifications_lues()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  update notifications set lu = true where destinataire_id = auth.uid() and lu = false;
end;
$$;

revoke all on function marquer_notifications_lues() from public;
grant execute on function marquer_notifications_lues() to authenticated;

-- ---------------------------------------------------------------------
-- Wiring: every existing state-changing function with a real recipient
-- now also calls creer_notification() once, right before its own final
-- UPDATE (or, for accept_transaction/toggler_like_publication, on the
-- one branch that actually matters -- see each comment). `create or
-- replace` with an identical signature leaves each function's existing
-- EXECUTE grant untouched (already established precedent, e.g. migration
-- 0025's own deliver_video() redefinition), so none of these need their
-- grants re-stated here.
-- ---------------------------------------------------------------------

-- accept_transaction: the fan who made the request is told it was
-- accepted. Fires once regardless of whether this cascades straight to
-- 'livree' for whatsapp (acceptance IS delivery there) -- there is no
-- separate "whatsapp delivered" notification type, 'demande_acceptee'
-- already covers it; only deliver_video()'s own type
-- ('video_livree') is video/shoutout-specific.
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
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into v_tx from transactions where id = p_transaction_id for update;

  if v_tx is null then
    raise exception 'transaction not found';
  end if;

  if v_tx.createur_id is distinct from auth.uid() then
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

  perform creer_notification(v_tx.fan_id, 'demande_acceptee', p_transaction_id, null, auth.uid());
end;
$$;

-- refuse_transaction: same recipient reasoning as accept_transaction.
create or replace function refuse_transaction(p_transaction_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx record;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into v_tx from transactions where id = p_transaction_id for update;

  if v_tx is null then
    raise exception 'transaction not found';
  end if;

  if v_tx.createur_id is distinct from auth.uid() then
    raise exception 'not authorized';
  end if;

  if v_tx.statut != 'en_attente' then
    raise exception 'transaction is not pending acceptance';
  end if;

  update transactions set statut = 'remboursee', repondu_at = now() where id = p_transaction_id;

  perform creer_notification(v_tx.fan_id, 'demande_refusee', p_transaction_id, null, auth.uid());
end;
$$;

-- deliver_video: the fan is told their video/shoutout is ready.
create or replace function deliver_video(p_transaction_id uuid, p_r2_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx record;
  v_offre_type text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into v_tx from transactions where id = p_transaction_id for update;

  if v_tx is null then
    raise exception 'transaction not found';
  end if;

  if v_tx.createur_id is distinct from auth.uid() then
    raise exception 'not authorized';
  end if;

  select type into v_offre_type from offres where id = v_tx.offre_id;
  if v_offre_type not in ('video', 'shoutout') then
    raise exception 'only video/shoutout offers are delivered via this function';
  end if;

  if v_tx.statut != 'validee' then
    raise exception 'transaction has not been accepted yet';
  end if;

  if v_tx.deadline_livraison is not null and now() > v_tx.deadline_livraison then
    raise exception 'delivery deadline has passed';
  end if;

  update transactions
    set statut = 'livree',
        livrable = jsonb_build_object('r2_key', p_r2_key),
        confirmation_fan = 'en_attente',
        deadline_confirmation = now() + interval '72 hours'
    where id = p_transaction_id;

  perform creer_notification(v_tx.fan_id, 'video_livree', p_transaction_id, null, auth.uid());
end;
$$;

-- confirmer_livraison_fan: the créateur is told their delivery was
-- confirmed.
create or replace function confirmer_livraison_fan(p_transaction_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx record;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into v_tx from transactions where id = p_transaction_id for update;

  if v_tx is null then
    raise exception 'transaction not found';
  end if;

  if v_tx.fan_id is distinct from auth.uid() then
    raise exception 'not authorized';
  end if;

  if v_tx.statut != 'livree' or v_tx.confirmation_fan != 'en_attente' then
    raise exception 'transaction is not awaiting fan confirmation';
  end if;

  update transactions
    set confirmation_fan = 'confirme', confirme_at = now()
    where id = p_transaction_id;

  perform creer_notification(v_tx.createur_id, 'confirmation_recue', p_transaction_id, null, auth.uid());
end;
$$;

-- contester_livraison_fan: the créateur is told their delivery was
-- disputed.
create or replace function contester_livraison_fan(p_transaction_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx record;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into v_tx from transactions where id = p_transaction_id for update;

  if v_tx is null then
    raise exception 'transaction not found';
  end if;

  if v_tx.fan_id is distinct from auth.uid() then
    raise exception 'not authorized';
  end if;

  if v_tx.statut != 'livree' or v_tx.confirmation_fan != 'en_attente' then
    raise exception 'transaction is not awaiting fan confirmation';
  end if;

  update transactions
    set confirmation_fan = 'conteste'
    where id = p_transaction_id;

  perform creer_notification(v_tx.createur_id, 'contestation_recue', p_transaction_id, null, auth.uid());
end;
$$;

-- resoudre_litige: notifies whichever party the decision favored --
-- 'litige_tranche_createur'/'litige_tranche_fan' name exactly who that
-- is, so the recipient follows directly from p_decision. Needs
-- fan_id/createur_id fetched explicitly first (the original version had
-- no `select * into v_tx`, only a direct UPDATE).
create or replace function resoudre_litige(
  p_transaction_id uuid,
  p_decision text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx record;
begin
  if not exists (
    select 1 from users where id = auth.uid() and est_admin = true
  ) then
    raise exception 'not authorized';
  end if;

  if p_decision not in ('faveur_createur', 'faveur_fan') then
    raise exception 'invalid decision: %', p_decision;
  end if;

  select * into v_tx from transactions
    where id = p_transaction_id
      and confirmation_fan = 'conteste'
      and litige_resolu_at is null;

  if v_tx is null then
    raise exception 'transaction not found or already resolved';
  end if;

  update transactions
    set litige_resolution = p_decision,
        litige_resolu_par = auth.uid(),
        litige_resolu_at = now(),
        litige_note_admin = p_note,
        confirmation_fan = case when p_decision = 'faveur_createur' then 'confirme' else confirmation_fan end,
        confirme_at = case when p_decision = 'faveur_createur' then now() else confirme_at end,
        statut = case when p_decision = 'faveur_fan' then 'remboursee' else statut end
    where id = p_transaction_id;

  if p_decision = 'faveur_createur' then
    perform creer_notification(v_tx.createur_id, 'litige_tranche_createur', p_transaction_id, null, auth.uid());
  else
    perform creer_notification(v_tx.fan_id, 'litige_tranche_fan', p_transaction_id, null, auth.uid());
  end if;
end;
$$;

-- traiter_retrait: notifies the créateur who requested the withdrawal.
-- transaction_id/publication_id both stay null -- this event is about a
-- demandes_retrait row, not a transaction or a publication.
create or replace function traiter_retrait(p_id uuid, p_decision text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_createur_id uuid;
begin
  if not exists (
    select 1 from users where id = auth.uid() and est_admin = true
  ) then
    raise exception 'not authorized';
  end if;

  if p_decision not in ('traite', 'refuse') then
    raise exception 'invalid decision: %', p_decision;
  end if;

  select createur_id into v_createur_id
    from demandes_retrait where id = p_id and statut = 'en_attente';

  if v_createur_id is null then
    raise exception 'demande not found or already handled';
  end if;

  update demandes_retrait
    set statut = p_decision,
        note_admin = p_note,
        traite_par = auth.uid(),
        traite_at = now()
    where id = p_id;

  perform creer_notification(
    v_createur_id,
    case when p_decision = 'traite' then 'retrait_traite' else 'retrait_refuse' end,
    null, null, auth.uid()
  );
end;
$$;

-- toggler_like_publication: only the "like" branch notifies (never
-- "unlike" -- undoing a like isn't an event worth surfacing), and never
-- when the fan likes their own publication (auteur_id = v_user_id) --
-- nobody needs to be told they liked their own post.
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

    if v_publication.auteur_id != v_user_id then
      perform creer_notification(v_publication.auteur_id, 'publication_aimee', null, p_publication_id, v_user_id);
    end if;
  end if;

  return query
    select v_liked, (select count(*)::int from publications_likes where publication_id = p_publication_id);
end;
$$;
