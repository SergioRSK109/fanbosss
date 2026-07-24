import { NextRequest, NextResponse } from "next/server";
import { parametresProfilSchema, pseudoLockedUntil } from "@/lib/validation";
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

  // Pseudo cool-down (30 days): the trigger enforce_pseudo_cooldown
  // (migration 0010) is the real guarantee -- it fires even on a direct
  // Supabase REST call that skips this route entirely. This pre-check
  // only exists to return a clean 403 with the unlock date instead of a
  // raw Postgres exception, and to avoid a wasted write attempt.
  if (parsed.data.pseudo !== undefined) {
    const { data: current } = await supabase
      .from("users")
      .select("pseudo, pseudo_modifie_at")
      .eq("id", user.id)
      .single();

    if (current && current.pseudo !== parsed.data.pseudo) {
      const lockedUntil = pseudoLockedUntil(current.pseudo_modifie_at);
      if (lockedUntil) {
        return NextResponse.json(
          {
            error: "pseudo change is locked for 30 days after the last change",
            pseudoLockedUntil: lockedUntil,
          },
          { status: 403 },
        );
      }
    }
  }

  const { data, error } = await supabase
    .from("users")
    .update(parsed.data)
    .eq("id", user.id)
    .select(
      "id, nom_affichage, pseudo, pseudo_modifie_at, bio, lien_reseau_social, classement_public, masque_exploration",
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
