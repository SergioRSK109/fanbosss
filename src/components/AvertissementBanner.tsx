"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import type { AvertissementNonVu } from "@/lib/avertissements";

// Admin warning mechanism (migration 0053) -- deliberately non-blocking,
// unlike AccountBlockedScreen: a warning is shown alongside the normal
// page (above {children} in the same 3 layouts AccountBlockedScreen
// lives in), never in place of it. Several pending warnings are shown
// ONE AT A TIME, oldest first (the list itself already arrives sorted
// that way from getAvertissementsNonVus()) -- closing one calls
// marquer_avertissement_vu() and, only on success, advances to the next
// by slicing the local list; a failed request leaves the current one
// in place so the user isn't left thinking it was dismissed when it
// wasn't.
export function AvertissementBanner({
  avertissements,
}: {
  avertissements: AvertissementNonVu[];
}) {
  const t = useTranslations("AvertissementBanner");
  const [remaining, setRemaining] = useState(avertissements);
  const [dismissing, setDismissing] = useState(false);
  const [error, setError] = useState("");

  if (remaining.length === 0) {
    return null;
  }

  const current = remaining[0];

  async function handleClose() {
    setDismissing(true);
    setError("");

    const response = await fetch("/api/avertissements/marquer-vu", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ avertissementId: current.id }),
    });

    setDismissing(false);

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? t("closeError"));
      return;
    }

    setRemaining((prev) => prev.slice(1));
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-5 pt-4 sm:px-6">
      <div className="flex items-start gap-3 rounded-2xl border border-accent-500/30 bg-accent-500/10 px-4 py-3 text-sm">
        <span className="text-lg" aria-hidden>
          ⚠️
        </span>
        <div className="flex-1">
          <p className="font-semibold text-accent-600 dark:text-accent-300">{t("heading")}</p>
          <p className="text-foreground">{current.raison}</p>
          {remaining.length > 1 && (
            <p className="mt-1 text-xs text-foreground-muted">
              {t("moreCount", { count: remaining.length - 1 })}
            </p>
          )}
          {error && <p className="mt-1 text-xs text-danger-600">{error}</p>}
        </div>
        <button
          type="button"
          onClick={handleClose}
          disabled={dismissing}
          aria-label={t("closeAriaLabel")}
          className="shrink-0 text-foreground-muted transition-colors hover:text-foreground disabled:opacity-50"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
