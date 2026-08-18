"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { GalerieTile } from "@/components/GalerieTile";
import { GalerieViewer } from "@/components/GalerieViewer";
import type { GalerieItem } from "@/lib/galerie";

export interface GalerieCreateurView {
  displayName: string | null;
  pseudo: string | null;
  photoUrl: string | null;
}

// The shape page.tsx (Server Component) hands down: every GalerieItem
// (src/lib/galerie.ts, unchanged scope/filtering rules) plus the
// créateur display info resolved from profils_publics -- never from
// `users`/`offres` directly, per the brief.
export interface GalerieItemView extends GalerieItem {
  createur: GalerieCreateurView;
}

type Translator = (key: string, values?: Record<string, string>) => string;

function tileAriaLabel(item: GalerieItemView, t: Translator, createurAnonymeLabel: string): string {
  const createurLabel = item.createur.displayName ?? item.createur.pseudo ?? createurAnonymeLabel;
  if (item.mediaType === "video") {
    return t("videoTileAriaLabel", { createur: createurLabel });
  }
  if (item.mediaType === "audio") {
    return t("audioTileAriaLabel", { createur: createurLabel });
  }
  return t("imageTileAriaLabel", { createur: createurLabel });
}

function filterChipClass(active: boolean): string {
  return [
    "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition",
    active ? "bg-brand-500 text-white" : "bg-surface-muted text-foreground-muted hover:bg-surface",
  ].join(" ");
}

// Fan gallery (Phase 3): filter (horizontal chips, purely client-side --
// no server round trip per créateur switch, per the brief) + grid + the
// fullscreen open-item overlay, all driven by plain useState here. No
// pagination/infinite scroll (out of scope for this V1, per the brief --
// a personal collection, not /explorer's public feed).
export function GalerieContent({
  items,
  initialCreateurId = null,
}: {
  items: GalerieItemView[];
  // Phase 4: pre-selects a filter chip when arriving via
  // /galerie?createur={id} (a créateur profile's own "voir dans ma
  // galerie" link) -- only ever the STARTING value, still a plain local
  // useState afterward, so the filter stays freely changeable exactly
  // like before this lot. An id with no matching item (stale link, lost
  // access since) just yields an empty filtered grid -- no crash, no
  // special-casing needed.
  initialCreateurId?: string | null;
}) {
  const t = useTranslations("Galerie");
  const createurAnonymeLabel = t("createurAnonyme");
  // null = "Tous" (the "all" option), never a real créateur id.
  const [selectedCreateurId, setSelectedCreateurId] = useState<string | null>(initialCreateurId);
  const [openItem, setOpenItem] = useState<GalerieItemView | null>(null);

  // Distinct créateurs, in the order they first appear -- items already
  // arrive sorted deliveredAt descending (computeGalerieItems), so this
  // naturally surfaces the most recently active créateur's chip first.
  const createurOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: { id: string; label: string; photoUrl: string | null }[] = [];
    for (const item of items) {
      if (seen.has(item.createurId)) {
        continue;
      }
      seen.add(item.createurId);
      options.push({
        id: item.createurId,
        label: item.createur.displayName ?? item.createur.pseudo ?? createurAnonymeLabel,
        photoUrl: item.createur.photoUrl,
      });
    }
    return options;
  }, [items, createurAnonymeLabel]);

  if (items.length === 0) {
    return (
      <div className="mt-10 flex flex-col items-center gap-1 text-center">
        <p className="text-sm font-medium text-foreground">{t("empty")}</p>
        <p className="max-w-xs text-sm text-foreground-muted">{t("emptyDetail")}</p>
      </div>
    );
  }

  const filteredItems = selectedCreateurId
    ? items.filter((item) => item.createurId === selectedCreateurId)
    : items;

  return (
    <div>
      <div className="flex gap-2 overflow-x-auto pb-3">
        <button
          type="button"
          onClick={() => setSelectedCreateurId(null)}
          className={filterChipClass(selectedCreateurId === null)}
        >
          {t("filterAllLabel")}
        </button>
        {createurOptions.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setSelectedCreateurId(option.id)}
            className={filterChipClass(selectedCreateurId === option.id)}
          >
            {option.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={option.photoUrl} alt="" className="h-5 w-5 shrink-0 rounded-full object-cover" />
            ) : (
              <span aria-hidden className="h-5 w-5 shrink-0 rounded-full bg-foreground-muted/25" />
            )}
            {option.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-1">
        {filteredItems.map((item) => (
          <GalerieTile
            key={item.transactionId}
            item={item}
            ariaLabel={tileAriaLabel(item, t, createurAnonymeLabel)}
            onOpen={() => setOpenItem(item)}
          />
        ))}
      </div>

      {openItem && (
        <GalerieViewer
          item={openItem}
          ariaLabel={tileAriaLabel(openItem, t, createurAnonymeLabel)}
          onClose={() => setOpenItem(null)}
        />
      )}
    </div>
  );
}
