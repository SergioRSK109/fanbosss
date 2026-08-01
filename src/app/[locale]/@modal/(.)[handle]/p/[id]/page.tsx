import { PublicationPermalinkView } from "@/components/PublicationPermalinkView";
import { PublicationViewerOverlay } from "@/components/PublicationViewerOverlay";

// Lot 5d: intercepts client-side navigation to /[handle]/p/[id] from
// anywhere else in the app (e.g. /home, /[handle] itself) and renders it
// as a fullscreen overlay instead of a full page transition -- the URL
// still genuinely changes to /@pseudo/p/{id} (shareable, and a refresh
// or direct hit on it renders the REAL page instead, see that route's
// own comment for why), but nothing here unmounts the page underneath.
// `(.)` matches route segments, not file-system depth -- @modal is a
// slot, invisible to the URL, so "[handle]" here is exactly one segment
// above where this file lives, the same as [locale]/[handle] itself;
// see Next's own Intercepting Routes docs, "Good to know" note on `(.)`
// ignoring @slot folders.
export default async function PublicationModalPage({
  params,
}: {
  params: Promise<{ handle: string; id: string }>;
}) {
  const { handle, id } = await params;

  return (
    <PublicationViewerOverlay>
      <PublicationPermalinkView handle={handle} id={id} />
    </PublicationViewerOverlay>
  );
}
