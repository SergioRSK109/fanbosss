"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

// Same nested-tab pattern as ProfileTabs.tsx (Lot 5a): all tabs' content
// is already rendered server-side by OffresPage and just handed in here
// as pre-built React nodes -- this component only toggles which one is
// visible. "Service" is the default (it's every offer type that existed
// before this lot; "Produit physique" and "Concours" were added later,
// each on top of this exact same pattern, never a rewrite of it).
export function OffresTabs({
  serviceContent,
  produitContent,
  concoursContent,
}: {
  serviceContent: React.ReactNode;
  produitContent: React.ReactNode;
  concoursContent: React.ReactNode;
}) {
  const t = useTranslations("OffresPage.tabs");
  const [tab, setTab] = useState<"service" | "produit" | "concours">("service");

  return (
    <div>
      <div className="mb-6 flex gap-2 border-b border-border">
        {(["service", "produit", "concours"] as const).map((value) => (
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
      <div className={tab === "service" ? "" : "hidden"}>{serviceContent}</div>
      <div className={tab === "produit" ? "" : "hidden"}>{produitContent}</div>
      <div className={tab === "concours" ? "" : "hidden"}>{concoursContent}</div>
    </div>
  );
}
