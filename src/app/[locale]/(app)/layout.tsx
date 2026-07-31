import { AppTabBar } from "@/components/AppTabBar";

// Lot 3: shared layout for the (app)-group tab-bar destinations still
// living here (/dashboard, /finance=Paiements, /offres, /parametres=Profile).
// /home and /explorer now have their own dedicated, minimal layouts
// instead (src/app/[locale]/home/layout.tsx, src/app/[locale]/explorer/layout.tsx)
// -- see the nav reorg lot below for why. A route group ((app), parens =
// no URL segment) is what lets the remaining 4 keep their existing URLs
// -- already used elsewhere as post-login/signup redirect targets --
// while sharing this nav shell. /admin, /createur/[id], /[handle],
// /classement etc. stay siblings outside this group, untouched.
//
// Nav reorg lot follow-up: this layout used to also carry an identity
// card (public-profile-link text, then just NotificationBell once the
// link itself was removed) above `{children}`. Both are gone now -- the
// profile link lives only in /parametres (ParametresForm's own
// instance), and the notification bell is deliberately not shown on any
// of the 4 pages still wrapped by this layout -- /home is the one
// exception, keeping its own NotificationBell instance in its own
// 3-zone header (see home/page.tsx's own comment), not this shared one.
// With nothing left to fetch data for, this layout no longer needs its
// own auth.getUser() call either -- it's back to the same minimal shape
// as home/layout.tsx and explorer/layout.tsx: just the tab bar around
// whatever the page itself renders.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 pb-24">{children}</div>
      <AppTabBar />
    </div>
  );
}
