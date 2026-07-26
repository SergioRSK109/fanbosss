import { NextRequest, NextResponse } from "next/server";
import { PSEUDO_FORMAT_REGEX, PSEUDO_MOTS_RESERVES, escapeIlike } from "@/lib/validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Real-time pseudo availability check for /parametres. Deliberately
// returns ONLY `{ disponible: boolean }` -- never anything about which
// account (if any) already holds the pseudo, so this can't be used to
// enumerate real accounts beyond "this exact handle is taken or not",
// which is no more than /@pseudo itself already reveals to anyone who
// guesses a handle and visits it directly.
//
// Applies the EXACT same rules as the real DB constraints (migration
// 0008): PSEUDO_FORMAT_REGEX mirrors users_pseudo_format,
// PSEUDO_MOTS_RESERVES mirrors users_pseudo_not_reserved, and the
// case-insensitive lookup below mirrors users_pseudo_lower_unique_idx --
// so a pseudo never reported "disponible" here can never fail at save
// time via /api/profil, and vice versa.
export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const pseudo = request.nextUrl.searchParams.get("pseudo");
  if (!pseudo) {
    return NextResponse.json({ error: "pseudo query parameter is required" }, { status: 400 });
  }

  // Format/reserved checks are pure and local -- never worth a DB
  // round-trip, and this also means a request for something the DB
  // could never accept anyway never touches profils_publics at all.
  if (!PSEUDO_FORMAT_REGEX.test(pseudo) || PSEUDO_MOTS_RESERVES.includes(pseudo.toLowerCase())) {
    return NextResponse.json({ disponible: false });
  }

  // profils_publics already exposes pseudo publicly -- anyone can
  // already discover it by visiting /@pseudo directly -- so reading it
  // here leaks nothing new; only `id` is selected, and only to compare
  // against the caller's own id, never returned. ILIKE with no wildcard
  // characters (escaped via escapeIlike, same as the [handle] route)
  // performs an exact case-insensitive match, mirroring
  // users_pseudo_lower_unique_idx.
  const { data: match } = await supabase
    .from("profils_publics")
    .select("id")
    .ilike("pseudo", escapeIlike(pseudo))
    .maybeSingle();

  // Excludes the caller's own current pseudo -- typing your own existing
  // handle back must read as "disponible", not "pris". The comparison
  // uses the caller's own authenticated id (from the session), never a
  // client-supplied value, so this can't be abused to check "is pseudo X
  // assigned to account Y" by passing an arbitrary id.
  const disponible = !match || match.id === user.id;

  return NextResponse.json({ disponible });
}
