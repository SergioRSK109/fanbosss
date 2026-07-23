import { NextRequest, NextResponse } from "next/server";
import { creerOffreSchema } from "@/lib/validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const createurId = request.nextUrl.searchParams.get("createurId");

  // Public view (id/type/prix/actif/createur_id only, never `config`) --
  // see migration 0006.
  let query = supabase.from("offres_publiques").select("*");
  if (createurId) {
    query = query.eq("createur_id", createurId);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ offres: data });
}

// One offer per (créateur, type, libelle) -- brief v3 point 4: the
// creation UI is a fixed settings row per type ("Si quelqu'un veut ton
// numéro WhatsApp... combien lui factures-tu ?"), not a repeatable
// "create new offer" flow -- EXCEPT for `video`, which allows several
// distinctly-labeled rows ("Anniversaire" at 10$, "Danse" at 15$). This is
// an upsert, enforced at the DB level by unique_offre_type_par_createur
// (migrations 0006/0007, NULLS NOT DISTINCT so the one-row rule still
// holds for every type whose libelle stays null) so it holds regardless
// of which client calls this route.
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = creerOffreSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // config is only included when explicitly provided: this route is what
  // the settings form calls to save a price/toggle, and it must not wipe
  // out config already set via the separate content-upload-url /
  // lien_live flow (contenu_debloque's r2_key, evenement_live's
  // lien_live) just because that particular save didn't mention it.
  const upsertPayload: Record<string, unknown> = {
    createur_id: user.id,
    type: parsed.data.type,
    prix: parsed.data.prix ?? null,
    libelle: parsed.data.libelle ?? null,
  };
  if (parsed.data.config !== undefined) {
    upsertPayload.config = parsed.data.config;
  }

  // Application-level checks mirror the DB constraints
  // (check_whatsapp_minimum_price, offres_prix_required_unless_don on
  // offres.prix) as defense in depth. The constraints are the real
  // guarantee -- see brief 0.2 -- this just gives a clean 400 instead of a
  // raw Postgres error.
  const { data, error } = await supabase
    .from("offres")
    .upsert(upsertPayload, { onConflict: "createur_id,type,libelle" })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ offre: data }, { status: 201 });
}
