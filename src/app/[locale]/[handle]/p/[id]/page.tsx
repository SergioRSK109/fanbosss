import { PublicationPermalinkView } from "@/components/PublicationPermalinkView";

// Lot 5c: a single publication's permalink, usefanboss.com/@pseudo/p/{id}
// -- the real, full-page route: reached directly (shared link, hard
// navigation/refresh) or by Next.js itself whenever a client-side
// navigation to this URL ISN'T intercepted (see the @modal slot's own
// (.)[handle]/p/[id] route, Lot 5d, which renders the identical content
// as a fullscreen overlay instead for in-app navigation). Like /home,
// this page deliberately does NOT redirect a logged-out visitor to
// /login -- the whole point of a shareable link is that an anonymous
// visitor can open it and see either the real content or a real teaser,
// exactly per this viewer's own visibility, same reasoning as /home
// itself. All of the actual fetch/validation/rendering logic lives in
// PublicationPermalinkView, shared verbatim with the intercepted route
// so the two can never drift.
export default async function PublicationPermalienPage({
  params,
}: {
  params: Promise<{ handle: string; id: string }>;
}) {
  const { handle, id } = await params;

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 p-5 sm:p-6">
      <PublicationPermalinkView handle={handle} id={id} />
    </main>
  );
}
