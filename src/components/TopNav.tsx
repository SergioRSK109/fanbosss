"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Logo } from "@/components/Logo";

// Nav reorg lot: this whole bar (logo, classement link, explorer link,
// LanguageSwitcher) used to render unconditionally from the root layout,
// "everywhere" -- including on the 5 AppTabBar destinations, which
// already have their own navigation (Home's own dedicated header, the
// bottom tab bar for all 5) and don't need a second one duplicating it.
// TopNav renders nothing at all on those 5 routes now, not just hiding
// the language switcher -- LanguageSwitcher itself still gets its own
// dedicated instance in /parametres's own content. Everywhere else --
// /login, /signup, public profile pages, etc. -- this bar (classement
// link, language switcher, and the explorer link once authenticated)
// stays exactly as before.
//
// /classement joined this hidden list in a follow-up: reached from
// /home's own leaderboard icon, it used to show this entire bar
// (including its own "🏆 Classement" link, duplicating the page's own
// "Classement" heading) while having no bottom tab bar at all -- the
// exact same mismatch /explorer had before it got its own minimal
// layout (src/app/[locale]/classement/layout.tsx now does the same for
// this page, so hiding TopNav here doesn't strand anyone without
// navigation).
//
// The public profile page (fanboss.app/@pseudo) had the exact same
// mismatch, but it can't just be added to this list: /[handle] is a
// dynamic segment, so the actual pathname is "/@sergio", "/@marie", etc
// -- never the literal string "/[handle]". A plain .includes() check
// can never match it no matter what gets added to the array, so it
// needs its own startsWith("/@") test alongside the fixed-route list
// (src/app/[locale]/[handle]/layout.tsx supplies the tab bar the same
// way classement/explorer's own layouts do).
//
// The concours broadcast screen (/concours/[id]/ecran) is the same
// dynamic-segment case again, one level deeper -- built to be filmed
// full-screen (see that page's own comment), it can't have this bar (or
// any other site chrome) visible at all. Same fix shape: a regex test
// alongside the fixed-route list, since "/concours/<uuid>/ecran" can
// never be a literal array entry either.
//
// "/" joined this list in the landing-page redesign lot: the very first
// screen a logged-out visitor sees (and the one re-shown on every PWA/TWA
// launch until they log in) now builds its own dedicated header inline
// (logo, a discreet "Se connecter" link, the language switcher -- see
// that page's own comment) rather than sharing this one, the same
// "route needs its own header, not this shared bar" reasoning as every
// other entry here. Unconditional on auth state, same as every other
// entry -- an already-authenticated visitor who lands on "/" (e.g.
// clicking the logo) also gets no TopNav here, matching that page's own
// "no functional change on the authenticated branch" scope (it never had
// a bespoke header of its own either way).
//
// "/signup" and "/login" joined this list in the header-declutter lot:
// this bar's own "🏆 Classement" link was a real conversion distraction
// on these two pages specifically -- worse than elsewhere, since a
// visitor here has already started investing in the form. Both pages now
// build their own minimal header instead (logo + a link to the *other*
// auth page + the language switcher, AuthPageHeader.tsx), same
// "route needs its own header, not this shared bar" reasoning as "/".
const TOP_NAV_HIDDEN_ROUTES = [
  "/",
  "/home",
  "/offres",
  "/finance",
  "/explorer",
  "/parametres",
  "/classement",
  "/signup",
  "/login",
];
const ECRAN_ROUTE_PATTERN = /^\/concours\/[^/]+\/ecran$/;

// This needed a client component (usePathname, same locale-stripped
// pathname AppTabBar already relies on) because the root layout wraps
// every page in this app, including these routes -- a plain Server
// Component layout has no reliable way to know which route it's
// currently rendering for.
export function TopNav({ isAuthenticated }: { isAuthenticated: boolean }) {
  const t = useTranslations("Nav");
  const pathname = usePathname();

  if (
    TOP_NAV_HIDDEN_ROUTES.includes(pathname) ||
    pathname.startsWith("/@") ||
    ECRAN_ROUTE_PATTERN.test(pathname)
  ) {
    return null;
  }

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
        <LanguageSwitcher />
      </div>
    </div>
  );
}
