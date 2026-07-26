-- Commission rate: 17% (absorbed frais/tva) -> 15% HT + TVA (16%)
-- repercutee au createur, standard marketplace-intermediation model. This
-- reverses migration 0018's "platform absorbs frais_agregateur/tva"
-- decision for tva specifically: the 15% commission is now a HT
-- (hors-taxes) rate, VAT is added on top of it, and that HT+TVA total is
-- what the createur actually pays -- so it's now deducted from their
-- share again, not absorbed by the platform. frais_agregateur (CinetPay's
-- own fee) is untouched by this migration -- still 3% of brut, still
-- absorbed by the platform, never passed through to the createur; only
-- the tva treatment changes here.
--
-- v_commission is now the HT commission (15% of brut, not 17%). v_tva is
-- still 16% of v_commission -- same formula as before, just computed on
-- the new 15% base. montant_net_createur is the real mechanical change:
-- montant - v_commission - v_tva (both commission and its VAT deducted),
-- not montant - v_commission alone. See CLAUDE.md's "Commission rate"
-- section for the full history (20% -> 17%/absorbed -> 15% HT + TVA
-- repercutee) and why.
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
    v_commission := round(new.montant * 0.15, 2);
    v_frais := round(new.montant * 0.03, 2);
    v_tva := round(v_commission * 0.16, 2);

    insert into paiements (
      transaction_id, montant_brut, commission_plateforme,
      frais_agregateur, tva, montant_net_createur,
      statut_paiement, reference_cinetpay
    )
    values (
      new.id, new.montant, v_commission,
      v_frais, v_tva, new.montant - v_commission - v_tva,
      'initie', new.reference_cinetpay
    )
    on conflict (transaction_id) do nothing;
  end if;

  return new;
end;
$$;
