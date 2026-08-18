import { notFound } from "next/navigation";
import { CreateurProfileView } from "@/components/CreateurProfileView";
import { getGalerieFan } from "@/lib/galerie";
import { getCreateurProfileData } from "@/lib/profil";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { escapeIlike } from "@/lib/validation";

// Public handle alias: fanboss.app/@pseudo. Deliberately NOT a folder
// named "@[pseudo]" -- Next.js reserves a leading "@" in a folder name for
// parallel route slots, so it would never match a literal "@sergio" path
// segment. Instead this is a normal dynamic segment ([handle]) that
// captures the WHOLE segment including the "@", which the code below
// strips before treating it as a pseudo lookup.
//
// Static routes (login, signup, dashboard, mes-transactions, createur,
// paiement) at this same level always take precedence over this dynamic
// one for their exact literal paths -- standard Next.js routing, verified
// against the reserved-word list in migration 0008 either way.
export default async function HandlePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle: rawHandle } = await params;

  // params values are NOT auto-decoded here: a literal "@" in the URL
  // arrives as the percent-encoded "%40" in this field (confirmed
  // empirically against a real dev server -- both /@sergio and
  // /en/@sergio produced handle === "%40sergio", identically in both
  // locales, which is what made this 404 regardless of language).
  const handle = decodeURIComponent(rawHandle);

  if (!handle.startsWith("@")) {
    notFound();
  }

  const pseudo = handle.slice(1);
  const supabase = await createSupabaseServerClient();

  // ILIKE treats `_` and `%` as wildcards, and `_` is a valid pseudo
  // character (format: [a-zA-Z0-9_]{3,20}) -- an unescaped ilike("pseudo",
  // "test_1") would match "testX1", "test01", etc, not just "test_1".
  // Escape before matching so the case-insensitive lookup is exact.
  const escapedPseudo = escapeIlike(pseudo);

  const { data: match } = await supabase
    .from("profils_publics")
    .select("id")
    .ilike("pseudo", escapedPseudo)
    .maybeSingle();

  if (!match) {
    notFound();
  }

  // Contextual "voir dans ma galerie" link (Phase 4). This page must stay
  // entirely reachable by a logged-out visitor exactly as before -- so
  // auth.getUser() is only ever consulted here, never used to redirect.
  // Run alongside getCreateurProfileData rather than after it: two
  // independent reads, no reason to serialize them.
  const [profile, userResult] = await Promise.all([
    getCreateurProfileData(match.id),
    supabase.auth.getUser(),
  ]);
  const {
    data: { user },
  } = userResult;

  if (!profile) {
    notFound();
  }

  // No session at all -> skip the extra getGalerieFan call entirely, per
  // the brief. Filtered to THIS créateur only (Phase 2's own createurId
  // option) -- never the visiting fan's whole gallery.
  const galerieItems = user ? await getGalerieFan(user.id, { createurId: match.id }) : [];

  return <CreateurProfileView profile={profile} hasGalerieItems={galerieItems.length > 0} />;
}
