import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Real authorization lives in refuser_verification() itself (SECURITY
// DEFINER, re-verifies auth.uid() is admin -- migration 0023).
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const demandeId = typeof body.demandeId === "string" ? body.demandeId : null;

  if (!demandeId) {
    return NextResponse.json({ error: "demandeId is required" }, { status: 400 });
  }

  const { error } = await supabase.rpc("refuser_verification", {
    p_demande_id: demandeId,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }

  return NextResponse.json({ status: "ok" });
}
