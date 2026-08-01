import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Thin RPC wrapper, same shape as /api/transactions/[id]/deliver --
// p_reference_suivi is entirely optional (a plain text tracking
// reference, no file involved), so an empty/missing value is passed
// through as null rather than an empty string.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const referenceSuivi = typeof body.referenceSuivi === "string" ? body.referenceSuivi.trim() : "";

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const { error } = await supabase.rpc("livrer_produit", {
    p_transaction_id: id,
    p_reference_suivi: referenceSuivi || null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ status: "ok" });
}
