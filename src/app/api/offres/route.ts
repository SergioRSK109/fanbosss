import { NextRequest, NextResponse } from "next/server";
import { creerOffreSchema } from "@/lib/validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const createurId = request.nextUrl.searchParams.get("createurId");

  let query = supabase.from("offres").select("*").eq("actif", true);
  if (createurId) {
    query = query.eq("createur_id", createurId);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ offres: data });
}

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

  // Application-level check mirrors the DB CHECK constraint
  // (check_whatsapp_minimum_price on offres.prix) as defense in depth.
  // The constraint is the real guarantee -- see brief 0.2 -- this just
  // gives a clean 400 instead of a raw Postgres error.
  const { data, error } = await supabase
    .from("offres")
    .insert({
      createur_id: user.id,
      type: parsed.data.type,
      prix: parsed.data.prix,
      config: parsed.data.config ?? {},
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ offre: data }, { status: 201 });
}
