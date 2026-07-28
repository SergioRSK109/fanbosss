import { NextRequest, NextResponse } from "next/server";
import { publierMessageSchema } from "@/lib/validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Thin wrapper -- publier_message() (migration 0029) is the real
// guarantee for every rule that matters (who may post at all, the
// auto-assigned type, visibilite forced to public for annonce_fanboss,
// the 10/24h rate limit); this route never re-implements any of it,
// same shape as every other RPC wrapper in this project.
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = publierMessageSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("publier_message", {
    p_contenu: parsed.data.contenu,
    p_image_r2_key: parsed.data.image_r2_key ?? null,
    p_visibilite: parsed.data.visibilite ?? "public",
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const row = data?.[0];
  return NextResponse.json({
    id: row?.id,
    type: row?.type,
    visibilite: row?.visibilite,
    createdAt: row?.created_at,
  });
}
