import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Real eligibility lives in toggler_like_publication() itself (SECURITY
// DEFINER, re-uses peut_voir_publication_complete() -- migration 0031);
// this route is a thin wrapper, same shape as /signaler.
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

  const { data, error } = await supabase.rpc("toggler_like_publication", {
    p_publication_id: id,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const row = data?.[0];
  return NextResponse.json({ liked: row?.liked, likesCount: row?.likes_count });
}
