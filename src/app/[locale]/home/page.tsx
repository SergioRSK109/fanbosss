import { getTranslations } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
import { Logo } from "@/components/Logo";
import { NotificationBell } from "@/components/NotificationBell";
import { PublicationComposer } from "@/components/PublicationComposer";
import { PublicationsList } from "@/components/PublicationsList";
import { LeaderboardIcon } from "@/components/ui/navIcons";
import { getNotifications, getUnreadNotificationCount } from "@/lib/notifications";
import {
  getPublicationsAccueil,
  getViewerContext,
  PUBLICATIONS_ACCUEIL_PAGE_SIZE,
} from "@/lib/publications";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Security audit fix: /home used to be deliberately reachable while
// logged out (Lot 5a's own original design -- the visibility layer was
// built so an anonymous visitor could see public posts and a locked
// teaser for soutiens-only ones). That decision is reversed here: /home
// now requires a session, same guard every other (app) page
// (/dashboard, /finance, /offres, /parametres) already uses. The
// publications_visibles-backed permalink page (/[handle]/p/[id]) and a
// créateur's own public profile (/[handle]) are UNAFFECTED and still
// deliberately stay reachable logged out -- only this one feed page's
// own access changed. publications_accueil's `anon` grant was revoked
// to match (migration 0033) -- this redirect is what makes that revoke
// safe: getPublicationsAccueil() below is now only ever called for an
// authenticated caller.
//
// Nav reorg lot: this page builds its own 3-zone header (leaderboard icon
// -> /classement, the FanBoss logo, NotificationBell) in place of the
// plain "Home"/"Accueil" title it used to show. /home is the one
// deliberate exception to the bell's removal everywhere else in the app
// (the shared (app) layout's own identity card, which used to also carry
// it, no longer renders it at all) -- this page keeps its own instance,
// in its original right-hand corner, fetching its own pseudo (needed for
// publication_aimee's permalink href, see notificationHref()'s own
// comment) and notifications.
export default async function HomePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: "HomePage" });
  const tNav = await getTranslations({ locale, namespace: "Nav" });
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect({ href: "/login", locale });
    return;
  }

  // publication_aimee's permalink needs the VIEWER's own pseudo (see
  // notificationHref()'s own comment).
  const { data: profil } = await supabase.from("users").select("pseudo").eq("id", user.id).single();
  const [notifications, unreadCount] = await Promise.all([
    getNotifications(supabase, profil?.pseudo ?? null),
    getUnreadNotificationCount(supabase),
  ]);

  // The composer is shown only for an admin or a créateur_verifie (the
  // brief's own rule) -- but publier_message() re-checks this exact same
  // rule again server-side regardless of what this page decides to show,
  // same "never trust the client alone" discipline as everywhere else in
  // this project. Lot 5c: toggler_repost_publication() authorizes the
  // exact same population, so this one query also decides every card's
  // repost eligibility on this page. viewerId (migration 0032) is what
  // each card's "..." menu uses to decide "Masquer ma publication" vs.
  // "Signaler"/mute.
  const { viewerId, canManagePublications: canManage } = await getViewerContext(supabase);

  const page = Math.max(1, Number(sp.page) || 1);
  const { publications, total } = await getPublicationsAccueil(page);
  const totalPages = Math.max(1, Math.ceil(total / PUBLICATIONS_ACCUEIL_PAGE_SIZE));

  function pageHref(targetPage: number) {
    return targetPage > 1 ? `/home?page=${targetPage}` : "/home";
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-5 sm:p-6">
      <header className="flex items-center justify-between">
        <Link
          href="/classement"
          aria-label={tNav("classement")}
          className="flex h-9 w-9 items-center justify-center rounded-full text-brand-600 hover:bg-surface-muted dark:text-brand-300"
        >
          <LeaderboardIcon className="h-6 w-6" />
        </Link>
        <Logo className="h-7 w-auto" />
        <NotificationBell notifications={notifications} unreadCount={unreadCount} />
      </header>

      {canManage && <PublicationComposer />}

      <PublicationsList publications={publications} canRepost={canManage} viewerId={viewerId} />

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <Link
            href={pageHref(page - 1)}
            className={`text-sm font-semibold ${
              page <= 1
                ? "pointer-events-none text-foreground-muted/40"
                : "text-brand-600 dark:text-brand-300"
            }`}
          >
            ← {t("previous")}
          </Link>
          <span className="text-sm text-foreground-muted">
            {t("pageIndicator", { page, total: totalPages })}
          </span>
          <Link
            href={pageHref(page + 1)}
            className={`text-sm font-semibold ${
              page >= totalPages
                ? "pointer-events-none text-foreground-muted/40"
                : "text-brand-600 dark:text-brand-300"
            }`}
          >
            {t("next")} →
          </Link>
        </div>
      )}
    </main>
  );
}
