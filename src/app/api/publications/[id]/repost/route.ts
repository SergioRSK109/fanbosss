import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Real behavior lives in toggler_repost_publication() itself (SECURITY
// DEFINER -- a real toggle since migration 0032: first call creates a
// repost under the same eligibility gates reposter_publication() always
// had (verified créateurs/admins only, target must be public,
// repost-allowed, not masked, not itself a repost, under the shared
// 10/24h rate limit); a second call on the same original deletes the
// repost instead. This route is a thin wrapper, same shape as every
// other RPC wrapper in this project.
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

  const { data, error } = await supabase.rpc("toggler_repost_publication", {
    p_publication_id: id,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const row = data?.[0];
  return NextResponse.json({
    reposted: row?.reposted,
    id: row?.id,
    type: row?.type,
    createdAt: row?.created_at,
  });
}
