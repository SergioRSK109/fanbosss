import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Thin wrapper around incrementer_vue_publication() (migration 0043),
// same shape as /like -- but deliberately NO auth check, unlike every
// other write route in this file: a view count is a public, non-
// sensitive metric (same reasoning as likes/partages counts themselves),
// and the RPC is granted to anon precisely so a logged-out visitor
// scrolling Explorer still counts. Real eligibility (only a video post
// can accrue a view) lives entirely in the RPC's own WHERE clause, not
// here -- this route never even checks whether the target has a video.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.rpc("incrementer_vue_publication", {
    p_publication_id: id,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ status: "ok" });
}
