"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

// Client-side only (no navigation, no query param) -- both tabs' content
// is already rendered server-side by CreateurProfileView and just handed
// in here as pre-built React nodes; this component only toggles which
// one is visible. Offres is the default per the brief, which is also why
// PublicationTeaser's "go see the offres" link can just point at the
// plain profile URL rather than needing a deep-link query param.
export function ProfileTabs({
  offresContent,
  publicationsContent,
}: {
  offresContent: React.ReactNode;
  publicationsContent: React.ReactNode;
}) {
  const t = useTranslations("CreateurProfile.tabs");
  const [tab, setTab] = useState<"offres" | "publications">("offres");

  return (
    <div>
      <div className="mb-4 flex gap-2 border-b border-border px-5">
        {(["offres", "publications"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            aria-current={tab === value ? "true" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
              tab === value
                ? "border-brand-500 text-brand-600 dark:text-brand-300"
                : "border-transparent text-foreground-muted hover:text-foreground"
            }`}
          >
            {t(value)}
          </button>
        ))}
      </div>
      <div className={tab === "offres" ? "" : "hidden"}>{offresContent}</div>
      <div className={tab === "publications" ? "" : "hidden"}>{publicationsContent}</div>
    </div>
  );
}
