import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Deliberately no visibility check here either client- or server-side
// beyond the publication existing -- see partager_publication()'s own
// comment (migration 0031): sharing a link reveals nothing the permalink
// page doesn't already show that same viewer. Idempotent (on conflict do
// nothing), so a repeat click from the same fan never inflates the
// count.
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

  const { data, error } = await supabase.rpc("partager_publication", {
    p_publication_id: id,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const row = data?.[0];
  return NextResponse.json({ partagesCount: row?.partages_count });
}
