import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// The state machine itself (ownership check, allowed transitions, deadline
// enforcement) lives in the accept_transaction() SECURITY DEFINER function
// (supabase/migrations/0002_functions_triggers.sql) -- this route is a thin
// wrapper so a créateur can never write an arbitrary statut directly.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const { error } = await supabase.rpc("accept_transaction", {
    p_transaction_id: id,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ status: "ok" });
}
