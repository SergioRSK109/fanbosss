import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Real authorization lives in emettre_avertissement() itself (SECURITY
// DEFINER, re-verifies auth.uid() is admin -- migration 0053), same
// thin-wrapper shape as every other /api/admin/* route in this project.
// Unlike suspendre-compte/bannir-compte, raison is required (not merely
// optional) -- rejected here with a clean 400 before ever reaching the
// RPC, mirroring that RPC's own "raison is required" check (this is the
// usual "clean 400 instead of a raw Postgres error" pattern, not a
// substitute for the RPC's own guarantee).
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
  const raison = typeof body.raison === "string" ? body.raison.trim() : "";

  if (!userId || !raison) {
    return NextResponse.json({ error: "userId and a non-blank raison are required" }, { status: 400 });
  }

  const { error } = await supabase.rpc("emettre_avertissement", {
    p_user_id: userId,
    p_raison: raison,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }

  return NextResponse.json({ status: "ok" });
}
