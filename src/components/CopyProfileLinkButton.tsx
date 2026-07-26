"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { buttonClass } from "@/components/ui/button-styles";

// "Copier" is the primary intent (the button's whole point is a quick
// clipboard copy for pasting into a bio/story/DM) -- the Web Share API is
// only a fallback for when the Clipboard API isn't available at all
// (some mobile webviews restrict it), not the other way around, unlike
// ShareCampagneButton (share-first, copy-fallback) where the button's own
// label is "Partager".
export function CopyProfileLinkButton({ pseudo }: { pseudo: string }) {
  const t = useTranslations("CopyProfileLink");
  const [copied, setCopied] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function handleClick() {
    setErrorMessage("");
    const url = `${window.location.origin}/@${pseudo}`;
    const shareText = t("shareText", { url });

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("clipboard unavailable");
      }
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      if (navigator.share) {
        try {
          await navigator.share({ text: shareText, url });
        } catch {
          // Visitor closed the native share sheet without picking a
          // target -- not an error.
        }
        return;
      }
      setErrorMessage(t("copyError"));
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={handleClick}
        className={buttonClass("outline", "sm", "self-start")}
      >
        {copied ? t("copied") : t("button")}
      </button>
      {errorMessage && <p className="text-xs text-danger-600">{errorMessage}</p>}
    </div>
  );
}
