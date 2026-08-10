import { NextRequest, NextResponse } from "next/server";
import { creerConcoursSchema } from "@/lib/validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Thin wrapper -- creer_concours() (migration 0045/0046) is the real
// guarantee for every rule that matters (ownership + type check on the
// campagne, mode always forced to 'entre_createurs'), never re-implemented
// here, same shape as every other RPC wrapper in this project.
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = creerConcoursSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("creer_concours", {
    p_nom: parsed.data.nom,
    p_date_fin: parsed.data.dateFin,
    p_campagne_id: parsed.data.campagneId,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ id: data });
}
