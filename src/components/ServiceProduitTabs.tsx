"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

// Phase 3 of the "produit physique" offer type -- a second, nested level
// of tabs INSIDE ProfileTabs' own "Offres" tab (Service/Publications
// stays the outer split; this only distinguishes Service from Produit
// within what used to be Offres' single content block). Deliberately a
// smaller, simpler component than OffresManager's own OffresTabs
// (créateur side, Lot Phase 2) -- this one has nothing to coordinate
// beyond which pre-built content block is visible, same "just a display
// filter" shape as ProfileTabs itself, whose visual style (underline on
// active, border-b) this mirrors exactly.
export function ServiceProduitTabs({
  serviceContent,
  produitContent,
}: {
  serviceContent: React.ReactNode;
  produitContent: React.ReactNode;
}) {
  const t = useTranslations("CreateurProfile.tabs");
  const [tab, setTab] = useState<"service" | "produit">("service");

  return (
    <div>
      <div className="mb-4 flex gap-2 border-b border-border">
        {(["service", "produit"] as const).map((value) => (
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
    </div>
  );
}
