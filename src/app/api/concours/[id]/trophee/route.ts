import { NextRequest, NextResponse } from "next/server";
import { definirTropheeConcoursSchema } from "@/lib/validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Thin wrapper -- definir_photo_trophee_concours() (migration 0047) is
// the real guarantee (organizer-only) -- never re-implemented here. The
// natural "upload-url -> PUT to R2 -> set the resulting key" flow this
// project already uses for offres.image_r2_key/contenu_debloque's
// config.r2_key.
export async function PATCH(
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

  const body = await request.json();
  const parsed = definirTropheeConcoursSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { error } = await supabase.rpc("definir_photo_trophee_concours", {
    p_concours_id: id,
    p_r2_key: parsed.data.r2Key,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ status: "ok" });
}
