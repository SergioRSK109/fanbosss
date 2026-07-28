import { notFound } from "next/navigation";
import { PublicationCard } from "@/components/PublicationCard";
import { getPublicationById, getViewerContext } from "@/lib/publications";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Lot 5c: a single publication's permalink, usefanboss.com/@pseudo/p/{id}
// -- reuses PublicationCard (and, for a locked one, PublicationTeaser
// through it) rather than duplicating the teaser/contenu-complet
// rendering logic a second time. Like /home, this page deliberately does
// NOT redirect a logged-out visitor to /login -- the whole point of a
// shareable link is that an anonymous visitor can open it and see either
// the real content or a real teaser, exactly per this viewer's own
// visibility, same reasoning as /home itself.
export default async function PublicationPermalienPage({
  params,
}: {
  params: Promise<{ handle: string; id: string }>;
}) {
  const { handle: rawHandle, id } = await params;

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

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 p-5 sm:p-6">
      <PublicationCard publication={publication} canRepost={canRepost} viewerId={viewerId} />
    </main>
  );
}
