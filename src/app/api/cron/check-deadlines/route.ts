import { NextRequest, NextResponse } from "next/server";
import { processAutomaticRefund } from "@/lib/refunds";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

// Runs hourly, triggered by an external scheduler (see README --
// deployment section) rather than Vercel's built-in crons: the Hobby plan
// caps those at once per day, which is too slow for brief 0.3's
// acceptation/livraison deadlines. Brief 0.3: handles BOTH deadline types
// separately -- (a) en_attente past deadline_acceptation, and (b) validee
// past deadline_livraison -- via process_transaction_deadlines() in
// supabase/migrations/0002_functions_triggers.sql, so a créateur who simply
// never responds can't leave a fan stuck indefinitely.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase.rpc("process_transaction_deadlines");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Attempts the real CinetPay refund for each transaction the RPC above
  // just marked 'remboursee' -- a no-op while remboursement_cinetpay_actif
  // is off (see src/lib/refunds.ts), which it is by default. Never throws,
  // so a CinetPay failure here can't turn an otherwise-successful cron run
  // into a 500.
  for (const row of data ?? []) {
    await processAutomaticRefund(supabase, row.transaction_id);
  }

  return NextResponse.json({ status: "ok", refunded: data ?? [] });
}
