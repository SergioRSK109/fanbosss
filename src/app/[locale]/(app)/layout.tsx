import { AppTabBar } from "@/components/AppTabBar";
import { AccountBlockedScreen } from "@/components/AccountBlockedScreen";
import { AvertissementBanner } from "@/components/AvertissementBanner";
import { getAccountBlockInfo } from "@/lib/accountStatus";
import { getAvertissementsNonVus } from "@/lib/avertissements";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Lot 3: shared layout for the (app)-group tab-bar destinations still
// living here (/finance=Paiements, /offres, /parametres=Profile).
// /dashboard used to be a fourth here too, until its remaining
// "Performance" content was merged into /parametres and the route itself
// deleted outright (Lot 3 merge follow-up) -- see /parametres/page.tsx.
// /home, /explorer, and /classement now have their own dedicated, minimal
// layouts instead (src/app/[locale]/home/layout.tsx,
// src/app/[locale]/explorer/layout.tsx, src/app/[locale]/classement/layout.tsx)
// -- see the nav reorg lot below for why. A route group ((app), parens =
// no URL segment) is what lets the remaining 3 keep their existing URLs
// -- already used elsewhere as post-login/signup redirect targets --
// while sharing this nav shell. /admin, /createur/[id], /[handle] etc.
// stay siblings outside this group, untouched.
//
// Nav reorg lot follow-up: this layout used to also carry an identity
// card (public-profile-link text, then just NotificationBell once the
// link itself was removed) above `{children}`. Both are gone now -- the
// profile link lives only in /parametres (ParametresForm's own
// instance), and the notification bell is deliberately not shown on any
// of the pages still wrapped by this layout -- /home is the one
// exception, keeping its own NotificationBell instance in its own
// 3-zone header (see home/page.tsx's own comment), not this shared one.
// Account suspension/ban (migration 0052): this layout's own
// auth.getUser() call came back once the block screen needed one -- see
// AccountBlockedScreen's own comment for why it has to live here (and in
// home/layout.tsx and explorer/layout.tsx) rather than as a single check
// higher up: each of the 3 layouts covering the 5 AppTabBar destinations
// composes independently under Next's App Router, with no prop channel
// from a parent layout down into these siblings. Each page below this
// layout keeps its own existing !user -> /login redirect untouched; a
// blocked account is still a real, logged-in session, so that guard
// alone would never catch it -- this is a second, independent check.
//
// Admin warning mechanism (migration 0053): AvertissementBanner is
// deliberately fetched only in the NOT-blocked branch -- a blocked
// session never reaches this far (it returns AccountBlockedScreen
// first), so there's no point querying avertissements for it; the
// banner would have nowhere to render anyway.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const blockInfo = user ? await getAccountBlockInfo(supabase, user.id) : null;

  if (blockInfo) {
    return <AccountBlockedScreen info={blockInfo} />;
  }

  const avertissements = user ? await getAvertissementsNonVus(supabase) : [];

  return (
    <div className="flex flex-1 flex-col">
      {avertissements.length > 0 && <AvertissementBanner avertissements={avertissements} />}
      <div className="flex-1 pb-24">{children}</div>
      <AppTabBar />
    </div>
  );
}
