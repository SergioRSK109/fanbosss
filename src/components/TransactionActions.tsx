"use client";

import { useState } from "react";
import type { OffreType } from "@/lib/validation";

const REVEAL_ENDPOINTS: Partial<Record<OffreType, string>> = {
  whatsapp: "whatsapp-link",
  video: "video-url",
  shoutout: "video-url",
  contenu_debloque: "content-url",
  evenement_live: "live-link",
};

const REVEAL_LABELS: Partial<Record<OffreType, string>> = {
  whatsapp: "Obtenir le lien WhatsApp",
  video: "Voir ma vidéo",
  shoutout: "Voir mon shoutout",
  contenu_debloque: "Débloquer le contenu",
  evenement_live: "Obtenir le lien du live",
};

export function TransactionActions({
  transactionId,
  type,
  statut,
}: {
  transactionId: string;
  type: OffreType;
  statut: string;
}) {
  const [link, setLink] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const endpoint = REVEAL_ENDPOINTS[type];

  if (statut !== "livree" || !endpoint) {
    return null;
  }

  async function reveal() {
    setErrorMessage("");
    const response = await fetch(`/api/transactions/${transactionId}/${endpoint}`);
    const body = await response.json();

    if (!response.ok) {
      setErrorMessage(body.error ?? "indisponible");
      return;
    }

    setLink(body.waLink ?? body.url ?? body.lienLive);
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={reveal}
        className="self-start text-sm font-semibold text-brand-600 dark:text-brand-300"
      >
        {REVEAL_LABELS[type]}
      </button>
      {link && (
        <a
          href={link}
          target="_blank"
          rel="noreferrer"
          className="self-start rounded-full bg-brand-50 px-3 py-1 text-sm font-medium text-brand-600 dark:bg-white/10 dark:text-brand-300"
        >
          Ouvrir →
        </a>
      )}
      {errorMessage && <p className="text-sm text-danger-600">{errorMessage}</p>}
    </div>
  );
}
