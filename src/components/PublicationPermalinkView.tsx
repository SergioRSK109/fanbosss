import { notFound } from "next/navigation";
import { PublicationCard } from "@/components/PublicationCard";
import { getPublicationById, getViewerContext } from "@/lib/publications";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// The actual content of a publication's permalink (usefanboss.com/@pseudo/p/{id})
// -- extracted out of the page itself so both the real, full-page route
// (src/app/[locale]/[handle]/p/[id]/page.tsx, for direct/shared links and
// hard navigation) and the intercepted, fullscreen-overlay route
// (src/app/[locale]/@modal/(.)[handle]/p/[id]/page.tsx, for internal
// client-side navigation -- Lot 5d) render the exact same
// fetch/validation/component, never two copies that could drift.
export async function PublicationPermalinkView({
  handle: rawHandle,
  id,
}: {
  handle: string;
  id: string;
}) {
  // Same percent-decoding gotcha as /[handle]/page.tsx -- a literal "@"
  // arrives percent-encoded ("%40"), not auto-decoded by Next.js.
  const handle = decodeURIComponent(rawHandle);

  if (!handle.startsWith("@")) {
    notFound();
  }
  const pseudo = handle.slice(1);

  const publication = await getPublicationById(id);
  if (!publication) {
    notFound();
  }

  // The URL's own handle is re-verified against the publication's real
  // author rather than trusted -- /@wrong-handle/p/{id} must 404, not
  // silently render someone else's post under the wrong URL. A
  // publication whose author never set a pseudo has no permalink at all
  // under this shape (only /createur/[id]'s own profile applies then),
  // so it 404s here too.
  if (!publication.auteur.pseudo || publication.auteur.pseudo.toLowerCase() !== pseudo.toLowerCase()) {
    notFound();
  }

  const supabase = await createSupabaseServerClient();
  const { viewerId, canManagePublications: canRepost } = await getViewerContext(supabase);

  return <PublicationCard publication={publication} canRepost={canRepost} viewerId={viewerId} />;
}
