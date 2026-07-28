"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

// Mirrors ReportButton.tsx's own simplicity (no raison text collected
// there either, migration 0001) -- one click, no confirmation dialog.
// Real eligibility lives server-side in signaler_publication() (migration
// 0030), which rejects reporting a post the caller can't fully see; this
// button only ever renders from PublicationCard.tsx (the full-content
// view), never from PublicationTeaser.tsx, consistent with that
// server-side restriction -- a locked post has no "Signaler" affordance
// to click in the first place.
export function ReportPublicationButton({ publicationId }: { publicationId: string }) {
  const t = useTranslations("Publications");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function handleReport() {
    setStatus("sending");
    const response = await fetch(`/api/publications/${publicationId}/signaler`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    setStatus(response.ok ? "sent" : "error");
  }

  if (status === "sent") {
    return <p className="text-xs text-foreground-muted">{t("reportSent")}</p>;
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={handleReport}
        disabled={status === "sending"}
        className="text-xs font-medium text-foreground-muted hover:text-danger-600"
      >
        {status === "sending" ? t("reportSending") : t("reportButton")}
      </button>
      {status === "error" && <p className="text-xs text-danger-600">{t("reportError")}</p>}
    </div>
  );
}
