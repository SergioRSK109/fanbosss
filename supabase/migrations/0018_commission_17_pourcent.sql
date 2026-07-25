-- Commission rate: 20% -> 17%, and montant_net_createur no longer
-- deducts frais_agregateur/tva from the créateur's share -- the platform
-- now absorbs both instead of passing them through. This was requested
-- previously but never actually implemented in
-- create_paiement_on_validation() -- the gap was found while building
-- the fundraising-campaigns feature (migration 0017), whose live payout
-- calculator was specified assuming a 17%/0.83-net formula that this
-- function didn't actually charge at the time (it was still 20%,
-- frais+TVA both deducted). See CLAUDE.md's "Commission rate" section.
--
-- frais_agregateur and tva are still computed and stored on every
-- `paiements` row exactly as before -- they remain real bookkeeping
-- (CinetPay's own fee, and VAT on the platform's commission), just no
-- longer subtracted from what the créateur actually receives. tva is
-- computed as 16% of the *new* 17%-based commission, not the old 20%
-- one -- it's VAT on whatever the platform's real commission revenue
-- now is.
create or replace function create_paiement_on_validation()
returns trigger
language plpgsql
as $$
declare
  v_commission numeric;
  v_frais numeric;
  v_tva numeric;
begin
  if new.statut = 'validee' and old.statut is distinct from 'validee' then
    v_commission := round(new.montant * 0.17, 2);
    v_frais := round(new.montant * 0.03, 2);
    v_tva := round(v_commission * 0.16, 2);

    insert into paiements (
      transaction_id, montant_brut, commission_plateforme,
      frais_agregateur, tva, montant_net_createur,
      statut_paiement, reference_cinetpay
    )
    values (
      new.id, new.montant, v_commission,
      v_frais, v_tva, new.montant - v_commission,
      'initie', new.reference_cinetpay
    )
    on conflict (transaction_id) do nothing;
  end if;

  return new;
end;
$$;
