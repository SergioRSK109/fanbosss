-- Automatic CinetPay refunds -- infrastructure only, real API call left as
-- a documented stub (see src/lib/cinetpay.ts#refundCinetPayPayment).
-- CinetPay's official refund/reversal endpoint could not be found in
-- publicly available documentation -- see CLAUDE.md "Automatic CinetPay
-- refunds" for exactly what was searched. Until that contract is
-- confirmed and the stub is replaced with a real call, marking a
-- transaction 'remboursee' only ever changes our internal bookkeeping; no
-- money moves. These columns exist so that gap is never silent.

-- On `transactions`, not `paiements`: a `paiements` row is only created
-- once a transaction reaches 'validee' (see create_paiement_on_validation
-- below), but the acceptation-deadline refund path fires while a
-- transaction is still 'en_attente' -- no paiements row exists yet at
-- that point. `transactions` always exists from the initial webhook
-- insert, for both refund paths.
alter table transactions add column reference_remboursement_cinetpay text;
alter table transactions add column remboursement_tentative_a timestamptz;
alter table transactions add column montant_rembourse numeric;
alter table transactions add column necessite_remboursement_manuel
  boolean not null default false;

-- Master switch. Defaults off -- see CLAUDE.md, never flip this on before
-- refundCinetPayPayment() is implemented against a confirmed contract and
-- tested against a real CinetPay sandbox account.
--
-- remboursement_pourcentage: percentage (0-100) of the original amount to
-- refund. Configurable rather than hardcoded to 100 because CinetPay's fee
-- policy on refunds isn't confirmed yet -- their terms mention refund fees
-- may apply depending on contract terms, and whether a refund returns the
-- fan's full payment or the amount net of CinetPay's own commission is
-- still an open question pending direct confirmation from CinetPay.
insert into parametres_plateforme (cle, valeur) values
  ('remboursement_cinetpay_actif', 'false'::jsonb),
  ('remboursement_pourcentage', '100'::jsonb)
on conflict (cle) do nothing;

-- Always flags a refunded transaction for the operator's manual worklist,
-- regardless of remboursement_cinetpay_actif -- the real CinetPay call
-- (once implemented) can only ever happen from application code (no HTTP
-- extension is installed in this database, and none is planned), so this
-- trigger cannot itself attempt it. Whatever calls
-- process_transaction_deadlines()/refuse_transaction() is responsible for
-- calling src/lib/refunds.ts#processAutomaticRefund() right after, which
-- clears this flag once (and only once) a real refund is confirmed. If
-- that never happens -- flag off, the call fails, or nothing ever attempts
-- it -- this simply stays true forever, which is the deliberately safe
-- failure mode: nothing is silently lost track of.
create or replace function handle_transaction_remboursement()
returns trigger
language plpgsql
as $$
begin
  if new.statut = 'remboursee' and old.statut is distinct from 'remboursee' then
    update paiements set statut_paiement = 'rembourse'
      where transaction_id = new.id;

    -- Self-referential UPDATE from an AFTER trigger on the same table:
    -- safe here, not an infinite loop -- it re-fires this trigger once
    -- more, but on that second pass old.statut = new.statut = 'remboursee'
    -- already, so the IF condition above is false and it stops there.
    update transactions set necessite_remboursement_manuel = true
      where id = new.id;
  end if;

  return new;
end;
$$;
