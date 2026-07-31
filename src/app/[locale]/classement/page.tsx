import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { ClassementEntry } from "@/lib/classementPublic";
import { getClassementPublicData } from "@/lib/classementPublic";

// Public leaderboard (product brief): reuses classement_volume/reactivite/
// progression exactly as they already are (migration 0008) via
// getClassementPublicData(), which only ever selects rank + the public
// profils_publics columns -- see classementPublic.test.ts for the
// assertion that this page never surfaces a count or amount beyond what
// those views already expose. No auth required, no RLS-restricted table
// touched.
function Section({
  title,
  entries,
  emptyLabel,
  anonymousLabel,
  rankLabel,
}: {
  title: string;
  entries: ClassementEntry[];
  emptyLabel: string;
  anonymousLabel: string;
  rankLabel: (rank: number) => string;
}) {
  return (
    <section>
      <h2 className="text-lg font-bold">{title}</h2>
      {entries.length === 0 ? (
        <p className="mt-3 text-sm text-foreground-muted">{emptyLabel}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {entries.map((entry) => {
            const href = entry.pseudo ? `/@${entry.pseudo}` : `/createur/${entry.createurId}`;
            return (
              <li key={entry.createurId}>
                <Link
                  href={href}
                  className="card flex items-center gap-3 px-3 py-2.5 transition-transform active:scale-[0.98]"
                >
                  <span className="w-8 shrink-0 text-center text-sm font-bold text-brand-600 dark:text-brand-300">
                    {rankLabel(entry.rang)}
                  </span>
                  {entry.photoUrl ? (
                    // Signed R2 URL, not a static/optimizable asset Next's Image can cache.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={entry.photoUrl}
                      alt=""
                      className="h-10 w-10 shrink-0 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-lg dark:bg-white/10">
                      🙂
                    </div>
                  )}
                  <span className="truncate text-sm font-semibold">
                    {entry.displayName ?? anonymousLabel}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default async function ClassementPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Classement" });

  const { volume, reactivite } = await getClassementPublicData();

  const rankLabel = (rank: number) => t("rank", { rank });

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-8 px-5 pt-4">
      <div>
        <h1 className="text-2xl font-bold">{t("heading")}</h1>
        <p className="mt-1 text-sm text-foreground-muted">{t("subheading")}</p>
      </div>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <Section
          title={t("sectionVolume")}
          entries={volume}
          emptyLabel={t("empty")}
          anonymousLabel={t("anonymous")}
          rankLabel={rankLabel}
        />
        <Section
          title={t("sectionReactivite")}
          entries={reactivite}
          emptyLabel={t("empty")}
          anonymousLabel={t("anonymous")}
          rankLabel={rankLabel}
        />
      </div>
    </main>
  );
}
