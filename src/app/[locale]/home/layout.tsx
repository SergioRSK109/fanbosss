import { AppTabBar } from "@/components/AppTabBar";

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
export default function HomeLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 pb-24">{children}</div>
      <AppTabBar />
    </div>
  );
}
