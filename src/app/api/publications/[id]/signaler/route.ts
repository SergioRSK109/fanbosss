import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Real authorization lives in signaler_publication() itself (SECURITY
// DEFINER, re-uses peut_voir_publication_complete() to reject reporting
// a post the caller can't fully see -- migration 0030); this route is a
// thin wrapper, same shape as every other RPC wrapper in this project.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const raison = typeof body.raison === "string" && body.raison.trim() ? body.raison.trim() : null;

  const { error } = await supabase.rpc("signaler_publication", {
    p_publication_id: id,
    p_raison: raison,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ status: "ok" });
}
