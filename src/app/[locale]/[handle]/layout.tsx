import { AppTabBar } from "@/components/AppTabBar";

// Nav reorg lot follow-up: the public profile page (fanboss.app/@pseudo)
// had the same leftover-header mismatch /explorer and /classement had
// before their own minimal layouts -- TopNav's full bar (logo, its own
// Classement/Explorer links, language switcher) rendering here instead of
// the app's own bottom tab bar. Same fix, same shape: this minimal layout
// renders only the tab bar, so [handle]/page.tsx itself needed zero
// changes. AppTabBar renders regardless of auth state (same as on
// /explorer and /classement), so an anonymous visitor opening someone's
// shared profile link still gets working navigation, not a dead end --
// this page is reachable logged out by design (a créateur's public
// profile), so the layout must never gate on auth either.
export default function HandleLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 pb-24">{children}</div>
      <AppTabBar />
    </div>
  );
}
