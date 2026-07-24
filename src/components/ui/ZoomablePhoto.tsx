"use client";

import { useState } from "react";

// Shared by the réglages photo preview and the public profile header --
// click-to-zoom (a simple fixed overlay, click-outside or the close
// button to dismiss) instead of a hover tooltip or a library, since most
// visitors are on mobile and this needs to work over a slow connection.
export function ZoomablePhoto({
  src,
  alt = "",
  thumbnailClassName,
  ariaLabel = "Agrandir la photo",
}: {
  src: string;
  alt?: string;
  thumbnailClassName: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={ariaLabel}
        className="shrink-0 rounded-full transition-transform active:scale-95"
      >
        {/* Signed R2 URL, not a static/optimizable asset Next's Image can cache. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className={thumbnailClassName} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={alt || "Photo agrandie"}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            onClick={(event) => event.stopPropagation()}
            className="max-h-[80vh] max-w-full rounded-2xl object-contain shadow-2xl"
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Fermer"
            className="absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm hover:bg-white/25"
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}
