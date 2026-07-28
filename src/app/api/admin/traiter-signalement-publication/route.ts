import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Real authorization lives in traiter_signalement_publication() itself
// (SECURITY DEFINER, re-verifies est_admin -- migration 0030), same
// shape as /api/admin/resoudre-litige/mark-remboursement-traite.
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const reportId = typeof body.reportId === "string" ? body.reportId : null;
  const decision = typeof body.decision === "string" ? body.decision : null;

  if (!reportId || !decision) {
    return NextResponse.json({ error: "reportId and decision are required" }, { status: 400 });
  }

  const { error } = await supabase.rpc("traiter_signalement_publication", {
    p_report_id: reportId,
    p_decision: decision,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }

  return NextResponse.json({ status: "ok" });
}
