"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

type AdminTab = "overview" | "financier" | "contenuConfiance" | "administration";

// Desktop-oriented top tab bar for /admin -- deliberately NOT the bottom
// fixed AppTabBar the créateur-facing app uses (that one is designed for
// a mobile PWA; this tool is a business-only, desktop-first dashboard,
// per explicit instruction). Same "pre-built ReactNode per tab, client
// component only toggles visibility" pattern as ProfileTabs.tsx -- every
// tab's content is already rendered server-side by AdminPage and handed
// in here, so no Manager component's own logic changes, only where its
// section is displayed. Content stays mounted (toggled via `hidden`
// rather than conditionally rendered) so switching tabs never resets a
// Manager's own in-flight pendingId/errorById state.
export function AdminTabs({
  overviewContent,
  financierContent,
  contenuConfianceContent,
  administrationContent,
  financierCount,
  contenuConfianceCount,
}: {
  overviewContent: React.ReactNode;
  financierContent: React.ReactNode;
  contenuConfianceContent: React.ReactNode;
  administrationContent: React.ReactNode;
  // Only these two tabs have a meaningful "en attente" notion -- Vue
  // d'ensemble and Administration are plain reads with nothing to
  // triage, so they never carry a badge (see AdminPage's own count
  // computation for what each sum includes).
  financierCount: number;
  contenuConfianceCount: number;
}) {
  const t = useTranslations("Admin.tabs");
  const [tab, setTab] = useState<AdminTab>("overview");

  const tabs: { value: AdminTab; count?: number }[] = [
    { value: "overview" },
    { value: "financier", count: financierCount },
    { value: "contenuConfiance", count: contenuConfianceCount },
    { value: "administration" },
  ];

  return (
    <div>
      <div className="mb-6 flex flex-wrap gap-2 border-b border-border">
        {tabs.map(({ value, count }) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            aria-current={tab === value ? "true" : undefined}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
              tab === value
                ? "border-brand-500 text-brand-600 dark:text-brand-300"
                : "border-transparent text-foreground-muted hover:text-foreground"
            }`}
          >
            {t(value)}
            {Boolean(count && count > 0) && (
              <span className="rounded-full bg-accent-500 px-2 py-0.5 text-xs font-bold text-white">
                {count}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className={tab === "overview" ? "flex flex-col gap-8" : "hidden"}>{overviewContent}</div>
      <div className={tab === "financier" ? "flex flex-col gap-8" : "hidden"}>{financierContent}</div>
      <div className={tab === "contenuConfiance" ? "flex flex-col gap-8" : "hidden"}>
        {contenuConfianceContent}
      </div>
      <div className={tab === "administration" ? "flex flex-col gap-8" : "hidden"}>
        {administrationContent}
      </div>
    </div>
  );
}
