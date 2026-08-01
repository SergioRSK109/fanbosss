import type { Publication } from "@/lib/publications";

// Deliberately its own tiny module, not part of @/lib/publications --
// that module also exports server-only data-fetching functions
// (createSupabaseServerClient, which itself imports next/headers), and a
// "use client" component that imports ANY runtime (non-type) value from
// it pulls that whole module graph into the client bundle. Real
// Turbopack build error, caught empirically (not spotted by inspection)
// the moment PublicationTile.tsx (Phase C's Explorer grid, which needs
// this function to compute a repost tile's click target) imported
// publicationPermalinkHref directly from @/lib/publications -- same
// class of bug, same fix, as PUBLICATION_CONTENU_MAX_LENGTH being moved
// out of @/lib/publications for PublicationComposer.tsx (see CLAUDE.md).
// `type Publication` is still imported from there -- type-only imports
// are erased before bundling, so that alone never triggers this.
export function publicationPermalinkHref(
  publication: Pick<Publication, "id" | "auteur">,
): string | null {
  return publication.auteur.pseudo ? `/@${publication.auteur.pseudo}/p/${publication.id}` : null;
}
