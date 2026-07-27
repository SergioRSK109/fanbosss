import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Lot 2a: a fan flagging a delivered video/shoutout as a problem.
// contester_livraison_fan() (same migration as confirm's route) only
// ever flips confirmation_fan to 'conteste' -- it never touches statut
// or attempts any refund, so this route doesn't either; the transaction
// just surfaces on /admin's "Litiges en attente" worklist for a human to
// review.
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

  const { error } = await supabase.rpc("contester_livraison_fan", {
    p_transaction_id: id,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ status: "ok" });
}
