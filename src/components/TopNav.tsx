"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Logo } from "@/components/Logo";

// Nav reorg lot: LanguageSwitcher used to render unconditionally in the
// root layout, "everywhere" -- including on the 5 AppTabBar destinations,
// which is exactly the kind of clutter this lot's brief calls out. It's
// now hidden on those 5 (an instance lives in /parametres's own content
// instead, alongside CopyProfileLinkButton) and stays visible everywhere
// else -- /login, /signup, public profile pages, etc. -- so a
// non-French-speaking visitor can still change language before ever
// creating an account.
//
// This needed a client component (usePathname, same locale-stripped
// pathname AppTabBar already relies on) because the root layout wraps
// every page in this app, including the 5 connected routes -- a plain
// Server Component layout has no reliable way to know which route it's
// currently rendering for.
const LANGUAGE_SWITCHER_HIDDEN_ROUTES = ["/home", "/offres", "/finance", "/explorer", "/parametres"];

export function TopNav({ isAuthenticated }: { isAuthenticated: boolean }) {
  const t = useTranslations("Nav");
  const pathname = usePathname();
  const showLanguageSwitcher = !LANGUAGE_SWITCHER_HIDDEN_ROUTES.includes(pathname);

  return (
    <div className="flex items-center justify-between px-4 py-3">
      <Link href="/" aria-label={t("homeAriaLabel")}>
        <Logo className="h-7 w-auto sm:h-8" />
      </Link>
      <div className="flex items-center gap-3">
        {/* Unlike Explorer (hidden pre-auth on purpose, so a logged-out
            visitor on signup/login isn't pulled away mid-flow), the
            leaderboard is deliberately public -- it's meant to be
            reachable without an account, so it's shown to every visitor
            regardless of auth state. */}
        <Link href="/classement" className="text-sm font-semibold text-brand-600 dark:text-brand-300">
          🏆 {t("classement")}
        </Link>
        {isAuthenticated && (
          <Link href="/explorer" className="text-sm font-semibold text-brand-600 dark:text-brand-300">
            🔎 {t("explorer")}
          </Link>
        )}
        {showLanguageSwitcher && <LanguageSwitcher />}
      </div>
    </div>
  );
}
