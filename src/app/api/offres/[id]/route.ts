import { NextRequest, NextResponse } from "next/server";
import { modifierOffreSchema, WHATSAPP_PRIX_MINIMUM } from "@/lib/validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Brief 0.2: this route must NOT be the thing preventing a whatsapp offer
// from dropping under $500 -- the DB constraint on offres.prix is what
// actually guarantees that, across every write path including this one.
// The check below is only a fast, friendly 400; removing it changes
// nothing about whether the drop is actually possible.
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
  const parsed = modifierOffreSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { data: existing, error: fetchError } = await supabase
    .from("offres")
    .select("id, type, createur_id")
    .eq("id", id)
    .single();

  if (fetchError || !existing) {
    return NextResponse.json({ error: "offre introuvable" }, { status: 404 });
  }

  if (existing.createur_id !== user.id) {
    return NextResponse.json({ error: "not authorized" }, { status: 403 });
  }

  if (
    existing.type === "whatsapp" &&
    parsed.data.prix !== undefined &&
    parsed.data.prix < WHATSAPP_PRIX_MINIMUM
  ) {
    return NextResponse.json(
      { error: `le prix d'une offre whatsapp doit être >= ${WHATSAPP_PRIX_MINIMUM}$` },
      { status: 400 },
    );
  }

  // Migration 0049: whenever actif is explicitly part of this request,
  // record whether this was a manual deactivation in the same write --
  // desactive_manuellement is what campagnes_publiques filters on to
  // distinguish "the créateur turned this off" (disappears from the
  // public profile entirely) from a campagne closing naturally (date_fin
  // passed / objectif reached, neither of which ever touches this
  // column -- see that migration's own comment). Reactivating (actif:
  // true) flips it back to false in this same update.
  const updatePayload: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.actif !== undefined) {
    updatePayload.desactive_manuellement = parsed.data.actif === false;
  }

  const { data, error } = await supabase
    .from("offres")
    .update(updatePayload)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    // If the application check above is ever wrong or bypassed, the DB
    // constraint (check_whatsapp_minimum_price) still rejects the write.
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ offre: data });
}
