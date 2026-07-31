import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
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
// Nav reorg lot: CopyProfileLinkButton no longer renders here at all --
// it was showing "everywhere via this shared layout" (including on
// /home, where it didn't belong), so it's been consolidated to live only
// in /parametres, where ParametresForm already renders its own instance
// next to the pseudo field. The rest of the identity card (public profile
// link text + NotificationBell) stays exactly as before for the pages
// still wrapped by this layout -- /home builds its own bespoke header
// (leaderboard/logo/bell) instead, which is why it moved out of this
// group rather than needing a route-conditional here.
//
// This does mean a third auth.getUser() call per request (root layout.tsx
// already does one for the Explorer nav link, each of the 4 pages does its
// own for its redirect-if-logged-out guard) -- same pattern already
// established by the root layout, not a new one. If there's no user (a
// direct hit on one of these URLs while logged out), this layout just
// renders nothing for the profile card and lets the page itself perform
// the actual redirect() to /login, exactly as before this lot.
export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Dashboard" });
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profil } = user
    ? await supabase.from("users").select("pseudo").eq("id", user.id).single()
    : { data: null as { pseudo: string | null } | null };

  // publication_aimee's permalink needs the VIEWER's own pseudo (see
  // notificationHref()'s own comment), so notifications are only fetched
  // once profil is known.
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
          <div className="card flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
            <div>
              <span className="text-foreground-muted">{t("publicProfileLabel")}</span>
              {profil?.pseudo ? (
                <Link
                  href={`/@${profil.pseudo}`}
                  className="font-semibold text-brand-600 dark:text-brand-300"
                >
                  fanboss.app/@{profil.pseudo}
                </Link>
              ) : (
                <>
                  <span className="text-foreground-muted">{t("noPseudoYet")}</span>
                  <Link href="/parametres" className="font-semibold text-brand-600 dark:text-brand-300">
                    {t("choosePseudo")}
                  </Link>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <NotificationBell notifications={notifications} unreadCount={unreadCount} />
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 pb-24">{children}</div>

      <AppTabBar />
    </div>
  );
}
