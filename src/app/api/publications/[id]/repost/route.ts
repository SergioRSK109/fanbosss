import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Real eligibility lives in reposter_publication() itself (SECURITY
// DEFINER -- verified créateurs/admins only, target must be public,
// repost-allowed, not masked, not itself a repost, and under the shared
// 10/24h rate limit -- migration 0031); this route is a thin wrapper,
// same shape as every other RPC wrapper in this project.
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

  const { data, error } = await supabase.rpc("reposter_publication", {
    p_publication_id: id,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const row = data?.[0];
  return NextResponse.json({ id: row?.id, type: row?.type, createdAt: row?.created_at });
}
