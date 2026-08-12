import { AppTabBar } from "@/components/AppTabBar";
import { AccountBlockedScreen } from "@/components/AccountBlockedScreen";
import { getAccountBlockInfo } from "@/lib/accountStatus";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Nav reorg lot: /home used to share (app)/layout.tsx with the other 4
// tab-bar destinations, which meant it also inherited that layout's
// generic "public profile link + bell" identity card -- exactly the kind
// of element that "accumulated" on Home without belonging there (see
// this lot's own brief). /home now builds its own bespoke header
// (leaderboard/logo/bell, see page.tsx) instead, so it needed to stop
// getting that card for free. Rather than adding a route conditional
// inside the shared (app) layout, /home moved out into its own minimal
// layout that renders nothing but the tab bar -- same "one dedicated
// layout per concern" shape /explorer's own new layout.tsx uses too.
//
// Account suspension/ban (migration 0052): same block-screen check as
// (app)/layout.tsx -- see AccountBlockedScreen's own comment for why
// this can't be a single shared check higher up. page.tsx's own
// !user -> /login redirect is untouched; a blocked account is still a
// real session, so this is a separate, second guard.
export default async function HomeLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const blockInfo = user ? await getAccountBlockInfo(supabase, user.id) : null;

  if (blockInfo) {
    return <AccountBlockedScreen info={blockInfo} />;
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 pb-24">{children}</div>
      <AppTabBar />
    </div>
  );
}
