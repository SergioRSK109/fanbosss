import { NextRequest, NextResponse } from "next/server";
import { escapeIlike, inviterConcoursSchema } from "@/lib/validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// The organizer only knows the invitee by pseudo -- resolved server-side
// to a real user id via the exact same escapeIlike()+profils_publics
// ilike lookup src/app/[locale]/[handle]/page.tsx already uses to
// resolve /@pseudo, reused here rather than a second, parallel
// resolution mechanism. Nothing sensitive leaks either way: pseudo is
// already public via profils_publics/@pseudo, so confirming "this handle
// resolves to a real créateur" reveals nothing a visitor couldn't
// already learn by loading /@<pseudo> directly.
//
// inviter_participant_concours() (migration 0046) itself is the real
// guarantee for who may invite (organizer-only) -- this route never
// re-checks that, only resolves the pseudo and forwards the call.
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
  const parsed = inviterConcoursSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const pseudo = parsed.data.pseudo.replace(/^@/, "");

  const { data: match } = await supabase
    .from("profils_publics")
    .select("id")
    .ilike("pseudo", escapeIlike(pseudo))
    .maybeSingle();

  if (!match) {
    return NextResponse.json({ error: "aucun créateur trouvé avec ce pseudo" }, { status: 404 });
  }

  const { error } = await supabase.rpc("inviter_participant_concours", {
    p_concours_id: id,
    p_createur_id: match.id,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ status: "ok" });
}
