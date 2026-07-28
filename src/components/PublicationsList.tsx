import { useTranslations } from "next-intl";
import { PublicationCard } from "@/components/PublicationCard";
import type { Publication } from "@/lib/publications";

export function PublicationsList({
  publications,
  canRepost = false,
}: {
  publications: Publication[];
  canRepost?: boolean;
}) {
  const t = useTranslations("Publications");

  if (publications.length === 0) {
    return <p className="text-center text-sm text-foreground-muted">{t("empty")}</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {publications.map((publication) => (
        <li key={publication.id}>
          <PublicationCard publication={publication} canRepost={canRepost} />
        </li>
      ))}
    </ul>
  );
}
