import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Toggles whether the caller mutes this créateur in their own /home feed
// -- toggler_mute_createur() (migration 0031) is the real guarantee
// (rejects an unauthenticated caller and a self-mute attempt); this
// route is a thin wrapper, same shape as every other RPC wrapper in this
// project. `id` here is a créateur id, not a publication id -- distinct
// from every other route under /api/publications.
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

  const { data, error } = await supabase.rpc("toggler_mute_createur", {
    p_createur_id: id,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const row = data?.[0];
  return NextResponse.json({ muted: row?.muted });
}
