"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

// Lot 5d: the fullscreen overlay rendered by the intercepted route
// (src/app/[locale]/@modal/(.)[handle]/p/[id]/page.tsx) -- content-
// agnostic, only owns the chrome (backdrop, sticky close bar, scroll
// container). `z-50` matches this app's existing "wins over the tab bar"
// convention (ZoomablePhoto/PhotoCropper, see CLAUDE.md) -- AppTabBar
// itself is z-40, so this comfortably covers it too, satisfying the
// brief's "couvre aussi la barre d'onglets du bas" requirement without
// needing to know anything about AppTabBar directly (this slot renders
// at the [locale] layout level, a sibling of every page's own layout
// tree, so it visually sits on top of all of it regardless).
export function PublicationViewerOverlay({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const t = useTranslations("Publications.viewer");

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-background">
      <div className="sticky top-0 z-10 flex justify-end border-b border-border bg-surface/95 px-4 py-3 backdrop-blur-sm">
        {/* router.back() (not a Link to a hardcoded route) is what makes
            "closing" land back exactly where the underlying feed was
            scrolled to -- this soft-closes the same history entry the
            interception itself pushed, per Next.js's own documented
            modal pattern (parallel + intercepting routes). */}
        <button
          type="button"
          onClick={() => router.back()}
          aria-label={t("closeAriaLabel")}
          className="flex h-9 w-9 items-center justify-center rounded-full text-foreground-muted hover:bg-surface-muted"
        >
          ✕
        </button>
      </div>
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-5 sm:p-6">{children}</div>
    </div>
  );
}
