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
      <button onClick={reveal} className="text-sm underline">
        {REVEAL_LABELS[type]}
      </button>
      {link && (
        <a
          href={link}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-violet-600"
        >
          Ouvrir
        </a>
      )}
      {errorMessage && <p className="text-red-600 text-sm">{errorMessage}</p>}
    </div>
  );
}
