import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Lot 2b: the $25 minimum and the available-balance check are both
// re-verified server-side inside demander_retrait() itself (migration
// 0027) -- this route is a thin wrapper, never the source of truth for
// either check, same shape as every other RPC wrapper in this project.
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const montant = typeof body.montant === "number" ? body.montant : null;

  if (montant === null) {
    return NextResponse.json({ error: "montant is required" }, { status: 400 });
  }

  const { error } = await supabase.rpc("demander_retrait", {
    p_montant: montant,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ status: "ok" });
}
