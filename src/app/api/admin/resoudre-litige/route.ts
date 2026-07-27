import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Real authorization lives in resoudre_litige() itself (SECURITY
// DEFINER, re-verifies auth.uid() is admin -- migration 0026), same
// shape as /api/admin/mark-remboursement-traite.
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const transactionId = typeof body.transactionId === "string" ? body.transactionId : null;
  const decision = typeof body.decision === "string" ? body.decision : null;
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;

  if (!transactionId || !decision) {
    return NextResponse.json(
      { error: "transactionId and decision are required" },
      { status: 400 },
    );
  }

  const { error } = await supabase.rpc("resoudre_litige", {
    p_transaction_id: transactionId,
    p_decision: decision,
    p_note: note,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }

  return NextResponse.json({ status: "ok" });
}
