import { useTranslations } from "next-intl";
import { PublicationCard } from "@/components/PublicationCard";
import type { Publication } from "@/lib/publications";

export function PublicationsList({
  publications,
  canRepost = false,
  viewerId = null,
  expandable = false,
}: {
  publications: Publication[];
  canRepost?: boolean;
  // Migration 0032 -- threaded down to each card's "..." menu so it can
  // tell "my own publication" apart from "someone else's".
  viewerId?: string | null;
  // Lot 5d (fullscreen viewer) -- see PublicationCard's own comment.
  // Defaults false like the props above; both current call sites
  // (/home, the profile Publications tab) pass true explicitly.
  expandable?: boolean;
}) {
  const t = useTranslations("Publications");

  if (publications.length === 0) {
    return <p className="text-center text-sm text-foreground-muted">{t("empty")}</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {publications.map((publication) => (
        <li key={publication.id}>
          <PublicationCard
            publication={publication}
            canRepost={canRepost}
            viewerId={viewerId}
            expandable={expandable}
          />
        </li>
      ))}
    </ul>
  );
}
