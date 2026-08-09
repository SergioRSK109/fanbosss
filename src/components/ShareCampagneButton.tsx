"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { buttonClass } from "@/components/ui/button-styles";

// Every campaign card carries a stable `id="campagne-{id}"` anchor (see
// CreateurProfileView) -- this button just builds a URL pointing at that
// exact anchor and hands it to the platform's native share sheet where
// available (mobile), falling back to copying to the clipboard
// (desktop) rather than assuming navigator.share always exists.
//
// Also reused as-is by the /concours/[id] public page (migration 0045):
// that call site passes neither prop at all, since a concours has no
// anchor to point at -- it *is* the whole page -- so this falls back to
// the current page's own full URL (window.location.href) instead of
// building a campagne anchor. The campagne-anchor path is unchanged for
// every existing call site.
export function ShareCampagneButton({
  campagneId,
  url: explicitUrl,
}: {
  campagneId?: string;
  url?: string;
}) {
  const t = useTranslations("CreateurProfile");
  const [copied, setCopied] = useState(false);

  async function handleShare() {
    const url =
      explicitUrl ??
      (campagneId
        ? `${window.location.origin}${window.location.pathname}#campagne-${campagneId}`
        : window.location.href);

    if (navigator.share) {
      try {
        await navigator.share({ url });
      } catch {
        // The visitor closed the native share sheet without picking a
        // target -- not an error, nothing to report.
      }
      return;
    }

    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button type="button" onClick={handleShare} className={buttonClass("outline", "sm", "self-start")}>
      {copied ? t("campagnes.shareCopied") : t("campagnes.share")}
    </button>
  );
}
