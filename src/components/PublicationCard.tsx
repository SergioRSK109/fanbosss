import { useLocale, useTranslations } from "next-intl";
import { PublicationActions } from "@/components/PublicationActions";
import { PublicationTeaser } from "@/components/PublicationTeaser";
import { RepostIcon } from "@/components/ui/icons";
import type { Publication } from "@/lib/publications";

function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function auteurHrefFor(auteur: Publication["auteur"]): string {
  return auteur.pseudo ? `/@${auteur.pseudo}` : `/createur/${auteur.id}`;
}

// The author row + contenu/image + badges shared by a plain post and a
// repost's embedded original -- factored out so the two never render
// this slightly-fiddly block two different ways.
function PublicationBody({ publication }: { publication: Publication }) {
  const t = useTranslations("Publications");
  const locale = useLocale();
  const { auteur } = publication;
  const auteurLabel = auteur.displayName ?? auteur.pseudo ?? t("anonymousAuteur");

  if (!publication.contenuComplet) {
    return <PublicationTeaser auteurHref={auteurHrefFor(auteur)} auteurLabel={auteurLabel} />;
  }

  return (
    <>
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
    </>
  );
}

export function PublicationCard({
  publication,
  canRepost = false,
}: {
  publication: Publication;
  // Same population as publier_message()'s own rule -- computed once per
  // page (canManagePublications, lib/publications.ts) and threaded all
  // the way down here. Defaults to false so a call site that genuinely
  // has no viewer context (there is none today, but this keeps the
  // component safe if one is ever added) never shows a repost button it
  // can't actually authorize.
  canRepost?: boolean;
}) {
  const t = useTranslations("Publications");
  const { auteur } = publication;
  const auteurLabel = auteur.displayName ?? auteur.pseudo ?? t("anonymousAuteur");

  return (
    <article className="card flex flex-col gap-3 p-4">
      {publication.repostDe && (
        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground-muted">
          <RepostIcon className="h-3.5 w-3.5" />
          {t("repostedBy", { auteur: auteurLabel })}
          {publication.type === "annonce_fanboss" && (
            <span className="shrink-0 rounded-full bg-accent-500/15 px-2 py-0.5 text-xs font-bold text-accent-600">
              FanBoss
            </span>
          )}
        </div>
      )}

      {publication.repostDe ? (
        <div className="rounded-2xl border border-border p-3">
          <PublicationBody publication={publication.repostDe} />
        </div>
      ) : (
        <PublicationBody publication={publication} />
      )}

      <div className="border-t border-border pt-2">
        <PublicationActions publication={publication} canRepost={canRepost} />
      </div>
    </article>
  );
}
