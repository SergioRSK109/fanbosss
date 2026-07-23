import { NextRequest, NextResponse } from "next/server";
import { parametresProfilSchema } from "@/lib/validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Settings: pseudo (public handle), bio, social link, classement opt-in.
// Self-only -- relies on the users_update_self RLS policy, no service-role
// needed since this always operates on the caller's own row. The pseudo
// format/reserved-word/uniqueness checks here mirror the DB constraints
// (users_pseudo_format, users_pseudo_not_reserved,
// users_pseudo_lower_unique_idx -- migration 0008) for a clean 400; the
// constraints are what actually guarantee it holds.
export async function PATCH(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = parametresProfilSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("users")
    .update(parsed.data)
    .eq("id", user.id)
    .select(
      "id, nom_affichage, pseudo, bio, lien_reseau_social, classement_public, masque_exploration",
    )
    .single();

  if (error) {
    // Most likely cause of a real-world failure here: pseudo already
    // taken (users_pseudo_lower_unique_idx). Postgres reports that as a
    // unique_violation (23505) through PostgREST.
    const status = error.code === "23505" ? 409 : 400;
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json({ profil: data });
}
