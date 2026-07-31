import { AppTabBar } from "@/components/AppTabBar";

// Nav reorg lot: /explorer becomes one of AppTabBar's 5 destinations
// without moving the page itself into the (app) route group -- doing so
// would have pulled in that group's shared identity card (public profile
// link + bell), which /explorer never had before and isn't asked to gain
// here (it must stay reachable, and look the same, for a logged-out
// visitor too). This minimal layout renders only the tab bar, same shape
// as home/layout.tsx, so explorer/page.tsx itself needed zero changes.
export default function ExplorerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 pb-24">{children}</div>
      <AppTabBar />
    </div>
  );
}
