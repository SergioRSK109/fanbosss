import { NextRequest, NextResponse } from "next/server";
import { demandeVerificationSchema } from "@/lib/validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Créateur verification request (migration 0023). The conflict check and
// the decision of the request's initial statut ('en_attente' vs
// 'conflit') both happen atomically inside creer_demande_verification()
// -- see that function's own comment for why this can't be a plain
// client-side INSERT (the conflict check needs to read other créateurs'
// nom_affichage, which RLS would otherwise block a plain authenticated
// caller from seeing).
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = demandeVerificationSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("creer_demande_verification", {
    p_plateforme: parsed.data.plateforme,
    p_lien_compte: parsed.data.lien_compte,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const row = data?.[0];
  return NextResponse.json({
    id: row?.id,
    codeVerification: row?.code_verification,
    statut: row?.statut,
  });
}
