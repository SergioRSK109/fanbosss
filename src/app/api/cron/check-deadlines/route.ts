import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

// Runs hourly (see vercel.json). Brief 0.3: handles BOTH deadline types
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

  return NextResponse.json({ status: "ok", refunded: data ?? [] });
}
