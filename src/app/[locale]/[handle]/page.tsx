import { notFound } from "next/navigation";
import { CreateurProfileView } from "@/components/CreateurProfileView";
import { getCreateurProfileData } from "@/lib/profil";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
  const { handle } = await params;

  if (!handle.startsWith("@")) {
    notFound();
  }

  const pseudo = handle.slice(1);
  const supabase = await createSupabaseServerClient();

  // ILIKE treats `_` and `%` as wildcards, and `_` is a valid pseudo
  // character (format: [a-zA-Z0-9_]{3,20}) -- an unescaped ilike("pseudo",
  // "test_1") would match "testX1", "test01", etc, not just "test_1".
  // Escape before matching so the case-insensitive lookup is exact.
  const escapedPseudo = pseudo.replace(/[\\%_]/g, (char) => `\\${char}`);

  const { data: match } = await supabase
    .from("profils_publics")
    .select("id")
    .ilike("pseudo", escapedPseudo)
    .maybeSingle();

  if (!match) {
    notFound();
  }

  const profile = await getCreateurProfileData(match.id);
  if (!profile) {
    notFound();
  }

  return <CreateurProfileView profile={profile} />;
}
