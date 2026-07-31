"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { CompassIcon, GiftIcon, HomeIcon, UserIcon, WalletIcon } from "@/components/ui/navIcons";

// Lot 3: the app's fixed bottom tab bar, mobile-app style, confirmed with
// the founder, rather than the previous mix of separate pages linked ad
// hoc from /dashboard's own header.
//
// Nav reorg lot: back to 5 tabs, but a different 5 than Lot 5a's. /home
// stays first; /dashboard ("Performance") was dropped from the bar first
// (route still worked via a direct URL, just unlinked from here) and was
// later deleted outright once its content actually merged into Profile
// (Lot 3 merge follow-up) -- see /parametres/page.tsx. /explorer (the
// public créateur directory, already existing) is wired in as a new
// destination. /parametres keeps its URL but is now labelled
// "Profile"/"Profil" -- same "route name vs. displayed label" split
// already established for /finance ("Paiements"). Icons are now
// hand-made SVG (src/components/ui/navIcons.tsx), not emoji, matching
// the discipline already used for the publication action bar (Lot 5c).
const TABS = [
  { href: "/home", Icon: HomeIcon, labelKey: "accueil" },
  { href: "/offres", Icon: GiftIcon, labelKey: "offres" },
  { href: "/finance", Icon: WalletIcon, labelKey: "paiements" },
  { href: "/explorer", Icon: CompassIcon, labelKey: "explorer" },
  { href: "/parametres", Icon: UserIcon, labelKey: "profile" },
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
              <tab.Icon className="h-5 w-5" active={active} />
              {t(tab.labelKey)}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
