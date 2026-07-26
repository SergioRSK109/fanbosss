import { getLocale, getTranslations } from "next-intl/server";
import { formatDepuis } from "@/lib/badgesFidelite";

// Private, self-only view of a fan's own loyalty badges -- unconditional
// on badge_fidelite_public (that flag only controls whether OTHERS see
// this, on the créateur's public profile and this fan's own public
// profile -- see migration 0022). Only rendered by the caller once
// there's at least one badge to show; no empty/zero state.
export async function BadgesFideliteCard({
  badges,
}: {
  badges: { createurId: string; displayName: string | null; depuis: string }[];
}) {
  const t = await getTranslations("Dashboard.badgesFidelite");
  const locale = await getLocale();

  return (
    <section className="card flex flex-col gap-2 px-4 py-4">
      <h2 className="text-sm font-bold text-foreground-muted">{t("heading")}</h2>
      <ul className="flex flex-col gap-1.5">
        {badges.map((badge) => (
          <li key={badge.createurId} className="text-sm">
            {t.rich("row", {
              createur: badge.displayName ?? t("anonymousCreateur"),
              date: formatDepuis(badge.depuis, locale),
              b: (chunks) => <span className="font-semibold">{chunks}</span>,
            })}
          </li>
        ))}
      </ul>
    </section>
  );
}
