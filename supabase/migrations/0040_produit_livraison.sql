-- Phase 2 of the "produit physique" offer type: créateur-facing UI
-- support — shipping address storage + the RPC that marks a produit
-- order shipped, opening the same 72h fan-confirmation escrow window
-- deliver_video() already opens for a delivered video/shoutout.

-- Collected at checkout in Phase 3 (fan-side quantity/address form,
-- still not built) -- the column is created now so this lot can
-- display/test the shipping screen without depending on Phase 3 ever
-- landing first. Nullable: every produit transaction created before
-- Phase 3 ships will simply have no address on file.
alter table transactions add column adresse_livraison text;

-- Same structure as deliver_video() (migration 0002, hardened in 0020):
-- auth.uid() rejected when null, `is distinct from` for the ownership
-- check (never `!=`, see migration 0020's own account of why), a row
-- lock via `for update`. Differs in three ways: no p_r2_key (a physical
-- product has no file to upload -- the tracking reference is plain
-- text, entirely optional), it requires type = 'produit' specifically
-- (the exact inverse of deliver_video()'s video/shoutout-only guard),
-- and it does NOT require the transaction to have been through a
-- distinct "accepted by the créateur" step first.
--
-- That last point is a deliberate, standing decision for this offer
-- type, not an oversight to "fix" later: the CinetPay webhook (migration
-- 0039, revised by this same migration -- see below) inserts a produit
-- transaction and immediately moves it to `validee` itself, with no
-- accept/refuse step in between at all, unlike video/whatsapp/shoutout.
-- A créateur listing a produit offer with a fixed price and a stock
-- count has nothing to individually approve per order the way a custom
-- video request might need refusing -- once paid, they're simply
-- obligated to ship it. `livrer_produit()` still requires the
-- transaction to have REACHED `validee` (a real payment must be on
-- record, matching the `create_paiement_on_validation()` trigger having
-- already fired) -- it just never demands a separate acceptation step
-- got there first.
create or replace function livrer_produit(p_transaction_id uuid, p_reference_suivi text default null)
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
  if v_offre_type is distinct from 'produit' then
    raise exception 'only produit offers are delivered via this function';
  end if;

  if v_tx.statut != 'validee' then
    raise exception 'transaction has not reached validee yet';
  end if;

  -- Same escrow window as deliver_video(): confirmation_fan starts the
  -- 72h fan-confirmation clock (migration 0025) -- a physical shipment
  -- is, if anything, even more warranted to hold in escrow than a
  -- video/shoutout is, since it takes days to arrive rather than being
  -- reviewable the instant it's delivered.
  update transactions
    set statut = 'livree',
        livrable = jsonb_build_object('reference_suivi', p_reference_suivi),
        confirmation_fan = 'en_attente',
        deadline_confirmation = now() + interval '72 hours'
    where id = p_transaction_id;
end;
$$;

revoke all on function livrer_produit(uuid, text) from public;
grant execute on function livrer_produit(uuid, text) to authenticated;
