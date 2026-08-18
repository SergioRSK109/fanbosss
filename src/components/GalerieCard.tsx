import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

// Fan gallery (Phase 4): entry point from /parametres, same visual
// pattern as ParrainageCard/ClassementProgresCard/BadgesFideliteCard
// already on this page -- a plain server component (no client
// interaction needed here, just a static count + a link), same shape as
// ClassementProgresCard. itemCount comes straight from getGalerieFan()
// (Phase 2, unmodified) called by ParametresPage -- never recomputed or
// re-derived here. Per the page's own existing convention for an
// empty-data card (see mesBadges.length > 0 && <BadgesFideliteCard .../>
// in parametres/page.tsx), the caller simply doesn't render this card at
// all when itemCount is 0, rather than this component handling an empty
// state itself.
export async function GalerieCard({ itemCount }: { itemCount: number }) {
  const t = await getTranslations("Parametres.galerie");

  return (
    <section className="card flex flex-col gap-2 px-4 py-4">
      <h2 className="text-sm font-bold text-foreground-muted">{t("heading")}</h2>
      <p className="text-sm text-foreground-muted">{t("itemCount", { count: itemCount })}</p>
      <Link
        href="/galerie"
        className="self-start text-sm font-semibold text-brand-600 dark:text-brand-300"
      >
        {t("link")}
      </Link>
    </section>
  );
}
