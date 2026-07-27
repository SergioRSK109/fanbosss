import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Real authorization lives in traiter_retrait() itself (SECURITY
// DEFINER, re-verifies auth.uid() is admin -- migration 0027), same
// pattern as /api/admin/resoudre-litige.
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const id = typeof body.id === "string" ? body.id : null;
  const decision = typeof body.decision === "string" ? body.decision : null;
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;

  if (!id || !decision) {
    return NextResponse.json({ error: "id and decision are required" }, { status: 400 });
  }

  const { error } = await supabase.rpc("traiter_retrait", {
    p_id: id,
    p_decision: decision,
    p_note: note,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }

  return NextResponse.json({ status: "ok" });
}
