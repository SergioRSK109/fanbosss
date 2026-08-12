import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Thin wrapper around marquer_avertissement_vu() (migration 0053), same
// shape as every other RPC wrapper route in this project. Real
// authorization (self-only, not-found-or-already-vu) lives entirely in
// the RPC itself.
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const avertissementId = typeof body.avertissementId === "string" ? body.avertissementId : null;

  if (!avertissementId) {
    return NextResponse.json({ error: "avertissementId is required" }, { status: 400 });
  }

  const { error } = await supabase.rpc("marquer_avertissement_vu", {
    p_avertissement_id: avertissementId,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ status: "ok" });
}
