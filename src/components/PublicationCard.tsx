import { useLocale, useTranslations } from "next-intl";
import { PublicationTeaser } from "@/components/PublicationTeaser";
import type { Publication } from "@/lib/publications";

function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PublicationCard({ publication }: { publication: Publication }) {
  const t = useTranslations("Publications");
  const locale = useLocale();
  const { auteur } = publication;
  const auteurHref = auteur.pseudo ? `/@${auteur.pseudo}` : `/createur/${auteur.id}`;
  const auteurLabel = auteur.displayName ?? auteur.pseudo ?? t("anonymousAuteur");

  if (!publication.contenuComplet) {
    return <PublicationTeaser auteurHref={auteurHref} auteurLabel={auteurLabel} />;
  }

  return (
    <article className="card flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2.5">
        {auteur.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={auteur.photoUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-base dark:bg-white/10">
            🙂
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-semibold">{auteurLabel}</p>
            {publication.type === "annonce_fanboss" && (
              <span className="shrink-0 rounded-full bg-accent-500/15 px-2 py-0.5 text-xs font-bold text-accent-600">
                FanBoss
              </span>
            )}
            {publication.visibilite === "soutiens" && (
              <span className="shrink-0 rounded-full bg-brand-500/15 px-2 py-0.5 text-xs font-bold text-brand-600 dark:text-brand-300">
                {t("soutiensOnlyBadge")}
              </span>
            )}
          </div>
          <p className="text-xs text-foreground-muted">
            {formatDate(publication.createdAt, locale)}
          </p>
        </div>
      </div>

      <p className="whitespace-pre-wrap text-sm leading-relaxed">{publication.contenu}</p>

      {publication.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={publication.imageUrl}
          alt=""
          className="max-h-96 w-full rounded-2xl object-cover"
        />
      )}
    </article>
  );
}
