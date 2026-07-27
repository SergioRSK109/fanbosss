import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { AppTabBar } from "@/components/AppTabBar";
import { CopyProfileLinkButton } from "@/components/CopyProfileLinkButton";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Lot 3: shared layout for the 4 tab-bar destinations (/dashboard=Performance,
// /finance=Paiements, /offres, /parametres=Réglages). A route group
// ((app), parens = no URL segment) is what lets these keep their existing
// URLs -- already used elsewhere as post-login/signup redirect targets --
// while sharing this nav shell. /admin, /createur/[id], /[handle],
// /explorer, /classement etc. stay siblings outside this group, untouched.
//
// The public profile link (fanboss.app/@pseudo + copy button) doesn't
// belong to any single tab -- it's identity, not one of the 4 categories
// (Performance/Paiements/Offres/Réglages) -- so per the brief it's kept
// visible above the tab bar on all 4 pages, via this shared layout,
// rather than duplicated into each page or awkwardly forced into one tab.
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
            {profil?.pseudo && <CopyProfileLinkButton pseudo={profil.pseudo} />}
          </div>
        </div>
      )}

      <div className="flex-1 pb-24">{children}</div>

      <AppTabBar />
    </div>
  );
}
