import { AppTabBar } from "@/components/AppTabBar";
import { AccountBlockedScreen } from "@/components/AccountBlockedScreen";
import { getAccountBlockInfo } from "@/lib/accountStatus";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Nav reorg lot: /explorer becomes one of AppTabBar's 5 destinations
// without moving the page itself into the (app) route group -- doing so
// would have pulled in that group's shared identity card (public profile
// link + bell), which /explorer never had before and isn't asked to gain
// here (it must stay reachable, and look the same, for a logged-out
// visitor too). This minimal layout renders only the tab bar, same shape
// as home/layout.tsx, so explorer/page.tsx itself needed zero changes.
//
// Account suspension/ban (migration 0052): same block-screen check as
// (app)/layout.tsx and home/layout.tsx. /explorer is the one of the 5
// tab-bar destinations that's otherwise fully public (no login redirect
// of its own) -- this check still applies to it: a suspended/banned
// visitor who still happens to hold a live session gets the block
// screen here too, same as the other 4, rather than being treated as an
// anonymous visitor just because this page doesn't otherwise require a
// session.
export default async function ExplorerLayout({ children }: { children: React.ReactNode }) {
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
