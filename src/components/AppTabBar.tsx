"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

// Lot 3: the app's fixed bottom tab bar, mobile-app style, confirmed with
// the founder, rather than the previous mix of separate pages linked ad
// hoc from /dashboard's own header. The route stays /finance (internal
// name unchanged since Lot 2b) -- only the displayed label is
// "Paiements"/"Payments", same "route name vs. label" split the old
// dashboard header link already established.
//
// Lot 5a: "Accueil" (/home) added as the new 1st tab, 5 total -- unlike
// the other 4, /home stays reachable while logged out (see its own page
// for why), so this bar itself renders the same regardless of auth state
// (as it already did before this lot); only the destination pages
// themselves decide whether to require a session.
const TABS = [
  { href: "/home", icon: "🏠", labelKey: "accueil" },
  { href: "/offres", icon: "🎁", labelKey: "offres" },
  { href: "/finance", icon: "💰", labelKey: "paiements" },
  { href: "/dashboard", icon: "📊", labelKey: "performance" },
  { href: "/parametres", icon: "⚙️", labelKey: "reglages" },
] as const;

export function AppTabBar() {
  const t = useTranslations("AppTabBar");
  const pathname = usePathname();

  return (
    <nav
      aria-label={t("navLabel")}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto flex max-w-2xl items-stretch justify-between px-2">
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-xs font-semibold transition-colors ${
                active
                  ? "text-brand-600 dark:text-brand-300"
                  : "text-foreground-muted hover:text-foreground"
              }`}
            >
              <span aria-hidden className="text-lg leading-none">
                {tab.icon}
              </span>
              {t(tab.labelKey)}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
