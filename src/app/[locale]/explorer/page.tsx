import { getTranslations } from "next-intl/server";
import { ExplorerGrid } from "@/components/ExplorerGrid";
import { inputClass } from "@/components/ui/field-styles";
import { buttonClass } from "@/components/ui/button-styles";
import { getPublicationsExplorables } from "@/lib/publications";

// Phase C: Explorer is now an Instagram-style publications grid, not a
// créateur-profile-card list -- the whole point of this rewrite is that
// discovery happens through actual content (what someone posted), not a
// static bio card. publications_explorables (migration 0038) already
// scopes this to verified créateurs + FanBoss announcements, public-only,
// respecting masque_exploration -- this page only adds the search bar and
// the first server-rendered batch on top, same "the view is the real
// guarantee, this page never re-implements it" discipline as every other
// public-view-backed page in this app.
export default async function ExplorerPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: "Explorer" });

  const q = typeof sp.q === "string" ? sp.q.trim() : "";

  const { publications, nextCursor } = await getPublicationsExplorables(q, null);

  return (
    <main className="mx-auto max-w-2xl px-1 pt-4 sm:px-5">
      <div className="px-4 sm:px-0">
        <h1 className="text-2xl font-bold">{t("heading")}</h1>
        <p className="mt-1 text-sm text-foreground-muted">{t("subheading")}</p>

        <form method="get" className="mt-5 flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder={t("searchPlaceholder")}
            className={`${inputClass} w-full sm:flex-1`}
          />
          <button type="submit" className={buttonClass("primary", "md")}>
            {t("searchButton")}
          </button>
        </form>
      </div>

      <div className="mt-6">
        {/* Keyed by `q` -- a new search is a fresh GET navigation with a
            brand new first batch/cursor from the server; the key forces
            ExplorerGrid to remount (and so reset its own infinite-scroll
            state) instead of keeping the previous query's tiles around
            underneath the new ones. */}
        <ExplorerGrid key={q} initialPublications={publications} initialCursor={nextCursor} q={q} />
      </div>
    </main>
  );
}
