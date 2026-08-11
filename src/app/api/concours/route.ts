import { NextRequest, NextResponse } from "next/server";
import { creerConcoursSchema } from "@/lib/validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Thin wrapper -- creer_concours() (migration 0045/0046, campagne
// auto-generation + points objective added in migration 0048) is the
// real guarantee for every rule that matters (mode always forced to
// 'entre_createurs', the DB's own concours_temps_record_requiert_objectif/
// concours_dates_coherentes constraints), never re-implemented here, same
// shape as every other RPC wrapper in this project. No campagneId in the
// request body at all since migration 0048 -- the RPC creates and owns
// its own synthetic campagne.
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
    p_date_debut: parsed.data.dateDebut ?? null,
    p_objectif_points: parsed.data.objectifPoints ?? null,
    p_temps_record: parsed.data.tempsRecord ?? null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ id: data });
}
