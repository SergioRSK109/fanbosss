import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// The real authorization check lives in set_admin_status() itself
// (SECURITY DEFINER, re-verifies auth.uid() is already admin -- see
// migration 0015) -- this route just needs an authenticated caller before
// forwarding to the RPC, same as /api/transactions/[id]/refuse.
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
  const estAdmin = typeof body.estAdmin === "boolean" ? body.estAdmin : null;

  if (!userId || estAdmin === null) {
    return NextResponse.json({ error: "userId and estAdmin are required" }, { status: 400 });
  }

  const { error } = await supabase.rpc("set_admin_status", {
    p_user_id: userId,
    p_est_admin: estAdmin,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }

  return NextResponse.json({ status: "ok" });
}
