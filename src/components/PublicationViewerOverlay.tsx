"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { BackIcon } from "@/components/ui/navIcons";

// Lot 5d: the fullscreen overlay rendered by the intercepted route
// (src/app/[locale]/@modal/(.)[handle]/p/[id]/page.tsx) -- content-
// agnostic, only owns the chrome (backdrop, back button, scroll
// container). `z-50` on the root matches this app's existing "wins over
// the tab bar" convention (ZoomablePhoto/PhotoCropper, see CLAUDE.md) --
// AppTabBar itself is z-40, so this comfortably covers it too, satisfying
// the brief's "couvre aussi la barre d'onglets du bas" requirement
// without needing to know anything about AppTabBar directly (this slot
// renders at the [locale] layout level, a sibling of every page's own
// layout tree, so it visually sits on top of all of it regardless).
//
// Follow-up fix: the close control used to live inside a full-width
// sticky bar (border-b + bg-surface/95 + backdrop-blur, spanning the
// whole screen width) -- removed entirely, not just re-aligned within
// it. The back button is now a small, isolated circle, `fixed` (not
// sticky, not wrapped in any bar-shaped container) in the viewport's own
// top-left corner, floating directly over the content -- it keeps its
// own tiny backdrop-blur circle purely for legibility against whatever
// image/video/text happens to sit behind it, never a strip spanning the
// screen.
export function PublicationViewerOverlay({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const t = useTranslations("Publications.viewer");

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 overflow-y-auto bg-background">
      {/* router.back() (not a Link to a hardcoded route) is what makes
          "closing" land back exactly where the underlying feed was
          scrolled to -- this soft-closes the same history entry the
          interception itself pushed, per Next.js's own documented modal
          pattern (parallel + intercepting routes). `fixed` keeps it
          pinned to the viewport's corner regardless of how far the
          content below is scrolled. */}
      <button
        type="button"
        onClick={() => router.back()}
        aria-label={t("backAriaLabel")}
        className="fixed left-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-surface/80 text-foreground-muted backdrop-blur-sm hover:bg-surface-muted"
      >
        <BackIcon className="h-5 w-5" />
      </button>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-5 pt-16 sm:p-6 sm:pt-16">{children}</div>
    </div>
  );
}
