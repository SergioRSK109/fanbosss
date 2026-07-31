import { AppTabBar } from "@/components/AppTabBar";
import { NotificationBell } from "@/components/NotificationBell";
import { getNotifications, getUnreadNotificationCount } from "@/lib/notifications";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
// Nav reorg lot follow-up: the public-profile-link text/link ("Ton profil
// public : fanboss.app/@pseudo") no longer renders here either, same
// reasoning as CopyProfileLinkButton's own earlier removal from this file
// -- it's redundant now that it only ever needs to live in /parametres
// (via ParametresForm's own instance), and showing it here duplicated
// that on every one of these 4 pages for no reason. Only NotificationBell
// remains from the old identity card; /home builds its own bespoke bell
// placement instead (leaderboard/logo/bell), which is why it moved out of
// this route group rather than needing a route-conditional here.
//
// This does mean a second auth.getUser() call per request (root
// layout.tsx already does one for the Explorer nav link, each of the 4
// pages does its own for its redirect-if-logged-out guard) -- same
// pattern already established by the root layout, not a new one. If
// there's no user (a direct hit on one of these URLs while logged out),
// this layout just renders nothing for the bell and lets the page itself
// perform the actual redirect() to /login, exactly as before this lot.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // publication_aimee's permalink needs the VIEWER's own pseudo (see
  // notificationHref()'s own comment) -- still needed purely to resolve
  // that href, even though the pseudo is no longer displayed anywhere in
  // this layout itself.
  const { data: profil } = user
    ? await supabase.from("users").select("pseudo").eq("id", user.id).single()
    : { data: null as { pseudo: string | null } | null };

  const [notifications, unreadCount] = user
    ? await Promise.all([
        getNotifications(supabase, profil?.pseudo ?? null),
        getUnreadNotificationCount(supabase),
      ])
    : [[], 0];

  return (
    <div className="flex flex-1 flex-col">
      {user && (
        <div className="mx-auto w-full max-w-2xl px-5 pt-5 sm:px-6">
          <div className="card flex items-center justify-end gap-3 px-4 py-3 text-sm">
            <NotificationBell notifications={notifications} unreadCount={unreadCount} />
          </div>
        </div>
      )}

      <div className="flex-1 pb-24">{children}</div>

      <AppTabBar />
    </div>
  );
}
