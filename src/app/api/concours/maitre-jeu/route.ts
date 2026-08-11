import { NextRequest, NextResponse } from "next/server";
import { creerConcoursMaitreJeuSchema } from "@/lib/validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Thin wrapper -- creer_concours_maitre_jeu() (migration 0047, gained the
// same points-objective parameters as creer_concours() in migration
// 0048) is the real guarantee (0-100 bound on the percentage, mode
// always forced server-side to 'maitre_du_jeu', the DB's own
// concours_temps_record_requiert_objectif/concours_dates_coherentes
// constraints), never re-implemented here. Distinct route from POST
// /api/concours (entre_createurs, creer_concours()) -- the organizer
// here isn't necessarily a créateur with a campagne to link, so the
// request body has no campagneId at all, same as before this migration.
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = creerConcoursMaitreJeuSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("creer_concours_maitre_jeu", {
    p_nom: parsed.data.nom,
    p_date_fin: parsed.data.dateFin,
    p_pourcentage_maitre_jeu: parsed.data.pourcentageMaitreJeu,
    p_date_debut: parsed.data.dateDebut ?? null,
    p_objectif_points: parsed.data.objectifPoints ?? null,
    p_temps_record: parsed.data.tempsRecord ?? null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ id: data });
}
