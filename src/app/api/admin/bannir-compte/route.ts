import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Real authorization lives in bannir_compte() itself (SECURITY DEFINER,
// re-verifies auth.uid() is admin -- migration 0052), same thin-wrapper
// shape as every other /api/admin/* route in this project.
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
  const raison = typeof body.raison === "string" && body.raison.trim() ? body.raison.trim() : null;

  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const { error } = await supabase.rpc("bannir_compte", {
    p_user_id: userId,
    p_raison: raison,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }

  return NextResponse.json({ status: "ok" });
}
