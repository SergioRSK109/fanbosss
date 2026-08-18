"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatExpirationDate } from "@/lib/formatDate";
import type { GalerieItemView } from "@/components/GalerieContent";

type Phase = "loading" | "ready" | "error";

// Fan gallery (Phase 3): the fullscreen open-item overlay. Per the
// brief's own explicit instruction, this is a plain local-state overlay
// (useState on the open item, in GalerieContent below) -- NOT the
// intercepted-route/@modal mechanism PublicationViewerOverlay uses.
// That mechanism exists so a publication stays reachable at a real,
// shareable permalink URL; gallery content is strictly private (only the
// owning fan can ever see it, per src/lib/galerie.ts's own RLS/service-
// role scoping), so there is no permalink to intercept in the first
// place -- a plain conditional render is simpler and just as correct
// here. This component DOES reuse PublicationViewerOverlay's visual
// chrome (dark fullscreen backdrop, a small floating circular close
// button, z-50 to win over the tab bar) and ZoomablePhoto's own
// full-screen photo treatment (max-h-[80vh] max-w-full rounded-2xl
// object-contain shadow-2xl) for visual consistency with the rest of
// this app -- but doesn't literally nest either component. ZoomablePhoto
// itself is a self-contained "click a small thumbnail to zoom" widget
// (its own button is hardcoded rounded-full, sized to its own
// thumbnail) -- it isn't built to be handed an already-resolved URL and
// rendered directly full-screen, and nesting it here would mean a
// second click just to see a photo that's already meant to open
// full-screen on the very first click. Reusing its *visual result*
// (the same classes on a plain <img>) gets the same look without that
// redundant interaction.
export function GalerieViewer({
  item,
  ariaLabel,
  onClose,
}: {
  item: GalerieItemView;
  ariaLabel: string;
  onClose: () => void;
}) {
  const t = useTranslations("Galerie");
  const tCommon = useTranslations("Common");
  const locale = useLocale();

  // image: already resolved server-side (getGalerieFan), nothing to
  // fetch -- starts (and stays) "ready" immediately.
  // video/audio: never resolved ahead of time (see deliveryRoute's own
  // comment in src/lib/galerie.ts) -- fetched here, on demand, the
  // instant the viewer opens.
  const [phase, setPhase] = useState<Phase>(item.mediaType === "image" ? "ready" : "loading");
  const [url, setUrl] = useState<string | null>(item.mediaType === "image" ? item.imageUrl : null);
  const [errorMessage, setErrorMessage] = useState("");

  const fetchSignedUrl = useCallback(async () => {
    try {
      const response = await fetch(`/api/transactions/${item.transactionId}/${item.deliveryRoute}`);
      const body = await response.json();

      if (!response.ok) {
        // A real, possible case per the brief: the content could have
        // expired (or otherwise stopped being deliverable) between the
        // gallery loading and this click -- shown verbatim, never a
        // silent failure.
        setErrorMessage(body.error ?? tCommon("unknownError"));
        setPhase("error");
        return;
      }

      setUrl(body.url);
      setPhase("ready");
    } catch {
      setErrorMessage(tCommon("unknownError"));
      setPhase("error");
    }
  }, [item.transactionId, item.deliveryRoute, tCommon]);

  // Wrapped in a 0ms setTimeout so the fetch's eventual setState calls
  // run from a macrotask callback, not synchronously reachable from the
  // effect body itself -- the same react-hooks/set-state-in-effect fix
  // already established in this codebase (ParametresForm's pseudo check,
  // ProduitCheckoutContent's own mount-triggered reservation).
  useEffect(() => {
    if (item.mediaType === "image") {
      return;
    }
    const timeout = setTimeout(() => void fetchSignedUrl(), 0);
    return () => clearTimeout(timeout);
  }, [item.mediaType, fetchSignedUrl]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-lg flex-col items-center"
      >
        {phase === "loading" && <p className="text-sm text-white/80">{t("loading")}</p>}
        {phase === "error" && (
          <p className="max-w-xs text-center text-sm text-danger-300">
            {errorMessage || t("loadError")}
          </p>
        )}
        {phase === "ready" && url && item.mediaType === "image" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="max-h-[80vh] max-w-full rounded-2xl object-contain shadow-2xl" />
        )}
        {phase === "ready" && url && item.mediaType === "video" && (
          <video
            controls
            playsInline
            src={url}
            className="max-h-[80vh] max-w-full rounded-2xl shadow-2xl"
          />
        )}
        {phase === "ready" && url && item.mediaType === "audio" && (
          <audio controls src={url} className="w-full" />
        )}
        {/* Only ever set for contenu_debloque (see GalerieItem's own
            comment in src/lib/galerie.ts) -- always null for video/
            shoutout, which never expires, so this never renders for
            those. */}
        {phase === "ready" && item.expiresAt && (
          <p className="mt-2 text-xs text-white/60">
            {t("expiresOn", { date: formatExpirationDate(item.expiresAt, locale) })}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={onClose}
        aria-label={tCommon("close")}
        className="fixed right-5 top-5 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm hover:bg-white/25"
      >
        ✕
      </button>
    </div>
  );
}
