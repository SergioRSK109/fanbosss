import { AppTabBar } from "@/components/AppTabBar";

// Nav reorg lot follow-up: /classement used to rely on the root layout's
// TopNav for all of its navigation (its own "🏆 Classement" link,
// duplicating this page's own heading, plus Explorer/language switcher)
// and had no bottom tab bar at all -- exactly the mismatch /explorer had
// before getting this same treatment. TopNav is now hidden here too (see
// TopNav.tsx), and this minimal layout -- same shape as
// home/layout.tsx/explorer/layout.tsx -- renders only the tab bar, so
// classement/page.tsx itself needed zero changes. AppTabBar renders
// regardless of auth state (same as on /explorer), so an anonymous
// visitor reaching /classement directly still gets working navigation,
// not a dead end.
export default function ClassementLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 pb-24">{children}</div>
      <AppTabBar />
    </div>
  );
}
