import type { SupabaseClient } from "@supabase/supabase-js";
import { refundCinetPayPayment } from "@/lib/cinetpay";

const DEFAULT_REFUND_PERCENTAGE = 100;

// Percentage of the original amount to refund. Configurable rather than
// hardcoded to 100 -- see cinetpay.ts's refundCinetPayPayment doc comment
// and CLAUDE.md "Automatic CinetPay refunds": whether a CinetPay refund
// returns the fan's full payment or the amount net of CinetPay's own
// commission is not yet confirmed. Rounds to the cent the same way the
// commission split in create_paiement_on_validation() does.
export function computeRefundAmount(montant: number, pourcentage: number): number {
  return Math.round(montant * (pourcentage / 100) * 100) / 100;
}

async function readPlatformFlag(
  supabase: SupabaseClient,
  cle: string,
): Promise<unknown> {
  const { data } = await supabase
    .from("parametres_plateforme")
    .select("valeur")
    .eq("cle", cle)
    .maybeSingle();
  return data?.valeur;
}

export async function isCinetPayRefundActive(supabase: SupabaseClient): Promise<boolean> {
  return (await readPlatformFlag(supabase, "remboursement_cinetpay_actif")) === true;
}

export async function getRefundPercentage(supabase: SupabaseClient): Promise<number> {
  const value = await readPlatformFlag(supabase, "remboursement_pourcentage");
  return typeof value === "number" && value >= 0 && value <= 100
    ? value
    : DEFAULT_REFUND_PERCENTAGE;
}

interface RefundableTransaction {
  id: string;
  montant: number;
  statut: string;
  reference_cinetpay: string | null;
  reference_remboursement_cinetpay: string | null;
  remboursement_tentative_a: string | null;
}

/**
 * Called right after a transaction transitions to 'remboursee' (from both
 * process_transaction_deadlines() and refuse_transaction()'s callers --
 * see /api/cron/check-deadlines and /api/transactions/[id]/refuse).
 *
 * transactions.necessite_remboursement_manuel is already set to true by
 * the handle_transaction_remboursement DB trigger the moment statut
 * became 'remboursee' -- this function's only job, while the feature flag
 * is on, is to attempt the real CinetPay call and clear that flag once
 * (and only once) a refund is genuinely confirmed. It never throws: a
 * failure here must never surface as an error to whatever action
 * triggered the refund (a créateur clicking "refuser", or the hourly
 * cron) -- necessite_remboursement_manuel staying true is the correct,
 * safe outcome of any failure, not something to retry blindly.
 */
export async function processAutomaticRefund(
  supabase: SupabaseClient,
  transactionId: string,
): Promise<void> {
  try {
    const { data: transaction } = await supabase
      .from("transactions")
      .select(
        "id, montant, statut, reference_cinetpay, reference_remboursement_cinetpay, remboursement_tentative_a",
      )
      .eq("id", transactionId)
      .maybeSingle<RefundableTransaction>();

    if (!transaction || transaction.statut !== "remboursee") {
      return;
    }

    // Idempotency, part 1: a real refund was already confirmed. Never
    // call again.
    if (transaction.reference_remboursement_cinetpay) {
      return;
    }

    if (!(await isCinetPayRefundActive(supabase))) {
      // necessite_remboursement_manuel already true from the trigger --
      // nothing else to do while the feature is off.
      return;
    }

    // Idempotency, part 2: a previous attempt was made and never got a
    // confirmed reference back -- this is genuinely ambiguous (a real
    // failure, or a timeout where CinetPay actually processed it and the
    // response never reached us). There is no confirmed CinetPay
    // "check refund status" endpoint to disambiguate this against (see
    // cinetpay.ts), so the only safe move is to NOT retry and leave it on
    // the manual worklist -- necessite_remboursement_manuel is already
    // true from the trigger.
    if (transaction.remboursement_tentative_a) {
      return;
    }

    const pourcentage = await getRefundPercentage(supabase);
    const montant = computeRefundAmount(transaction.montant, pourcentage);

    // Recorded BEFORE the call, not after -- so a request that times out
    // on our side (but may have succeeded on CinetPay's) is remembered as
    // "attempted", which is exactly what the idempotency check above
    // reads on any retry.
    await supabase
      .from("transactions")
      .update({ remboursement_tentative_a: new Date().toISOString() })
      .eq("id", transactionId);

    const reference = await refundCinetPayPayment({
      transactionId: transaction.id,
      referenceCinetpayOriginal: transaction.reference_cinetpay,
      montant,
    });

    await supabase
      .from("transactions")
      .update({
        reference_remboursement_cinetpay: reference,
        montant_rembourse: montant,
        necessite_remboursement_manuel: false,
      })
      .eq("id", transactionId);
  } catch (err) {
    console.error(
      `[refunds] automatic CinetPay refund failed for transaction ${transactionId}:`,
      err,
    );
  }
}
