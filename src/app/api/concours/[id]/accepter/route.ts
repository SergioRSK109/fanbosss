import { NextRequest, NextResponse } from "next/server";
import { accepterConcoursSchema } from "@/lib/validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Thin wrapper -- accepter_invitation_concours() (migration 0046, its
// signature extended by 0047 with p_conditions_acceptees) is the real
// guarantee (eligibility: own row, still 'invite'; ownership+type on the
// supplied campagne, via the same verifier_campagne_du_createur() helper
// creer_concours() itself uses; and, for a maitre_du_jeu concours, that
// conditions_acceptees is genuinely true) -- never re-implemented here.
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

  const body = await request.json();
  const parsed = accepterConcoursSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { error } = await supabase.rpc("accepter_invitation_concours", {
    p_concours_id: id,
    p_campagne_id: parsed.data.campagneId,
    // Only meaningful for a mode='maitre_du_jeu' concours -- the RPC
    // (migration 0047) ignores it entirely for entre_createurs. Defaults
    // to false, matching the RPC's own default, when the entre_createurs
    // consent screen was never shown at all.
    p_conditions_acceptees: parsed.data.conditionsAcceptees ?? false,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ status: "ok" });
}
