"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass } from "@/components/ui/button-styles";
import type { OffreType } from "@/lib/validation";

const REVEAL_ENDPOINTS: Partial<Record<OffreType, string>> = {
  whatsapp: "whatsapp-link",
  video: "video-url",
  shoutout: "video-url",
  contenu_debloque: "content-url",
  evenement_live: "live-link",
};

export function TransactionActions({
  transactionId,
  type,
  statut,
  confirmationFan,
}: {
  transactionId: string;
  type: OffreType;
  statut: string;
  // Lot 2a: only ever 'en_attente' for a delivered video/shoutout
  // awaiting the fan's confirmation -- every other type/state means
  // there's nothing to show here (see
  // supabase/migrations/0025_confirmation_fan_video_shoutout.sql).
  // Optional since callers for other offer types never pass it.
  confirmationFan?: string | null;
}) {
  const t = useTranslations("Dashboard.transactionActions");
  const tConfirmation = useTranslations("Dashboard.confirmation");
  const tCommon = useTranslations("Common");
  const router = useRouter();
  const [link, setLink] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [confirmationPending, setConfirmationPending] = useState(false);
  const endpoint = REVEAL_ENDPOINTS[type];

  async function respondToConfirmation(action: "confirm" | "contest") {
    setConfirmationPending(true);
    setErrorMessage("");
    const response = await fetch(`/api/transactions/${transactionId}/${action}`, {
      method: "POST",
    });
    const body = await response.json();

    if (!response.ok) {
      setErrorMessage(body.error ?? tCommon("unknownError"));
      setConfirmationPending(false);
      return;
    }

    // Re-fetches the transaction's real confirmation_fan from the server
    // -- this component doesn't keep its own copy of it, the parent list
    // does, so a successful confirm/contest must make these buttons
    // disappear via a fresh render, not local state.
    router.refresh();
  }

  if (statut !== "livree" || !endpoint) {
    return null;
  }

  async function reveal() {
    setErrorMessage("");
    const response = await fetch(`/api/transactions/${transactionId}/${endpoint}`);
    const body = await response.json();

    if (!response.ok) {
      setErrorMessage(body.error ?? t("unavailable"));
      return;
    }

    setLink(body.waLink ?? body.url ?? body.lienLive);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <button
          onClick={reveal}
          className="self-start text-sm font-semibold text-brand-600 dark:text-brand-300"
        >
          {t(`reveal.${type}`)}
        </button>
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="self-start rounded-full bg-brand-50 px-3 py-1 text-sm font-medium text-brand-600 dark:bg-white/10 dark:text-brand-300"
          >
            {t("open")}
          </a>
        )}
      </div>
      {confirmationFan === "en_attente" && (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={confirmationPending}
            onClick={() => respondToConfirmation("confirm")}
            className={buttonClass("success", "sm")}
          >
            {tConfirmation("satisfait")}
          </button>
          <button
            type="button"
            disabled={confirmationPending}
            onClick={() => respondToConfirmation("contest")}
            className={buttonClass("danger", "sm")}
          >
            {tConfirmation("signalerProbleme")}
          </button>
        </div>
      )}
      {errorMessage && <p className="text-sm text-danger-600">{errorMessage}</p>}
    </div>
  );
}
