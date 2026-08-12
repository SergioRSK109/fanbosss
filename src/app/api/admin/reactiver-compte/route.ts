import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Real authorization lives in reactiver_compte_admin() itself (SECURITY
// DEFINER, re-verifies auth.uid() is admin -- migration 0052), same
// thin-wrapper shape as every other /api/admin/* route in this project.
// Admin-only by design -- there is deliberately no equivalent route (or
// RPC) an affected user could call on their own account.
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const userId = typeof body.userId === "string" ? body.userId : null;

  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const { error } = await supabase.rpc("reactiver_compte_admin", {
    p_user_id: userId,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }

  return NextResponse.json({ status: "ok" });
}
