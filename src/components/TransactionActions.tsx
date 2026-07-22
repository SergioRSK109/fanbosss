"use client";

import { useState } from "react";

export function TransactionActions({
  transactionId,
  type,
  statut,
}: {
  transactionId: string;
  type: "video" | "don" | "whatsapp";
  statut: string;
}) {
  const [link, setLink] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  if (statut !== "livree" || type === "don") {
    return null;
  }

  async function reveal() {
    setErrorMessage("");
    const endpoint =
      type === "whatsapp"
        ? `/api/transactions/${transactionId}/whatsapp-link`
        : `/api/transactions/${transactionId}/video-url`;

    const response = await fetch(endpoint);
    const body = await response.json();

    if (!response.ok) {
      setErrorMessage(body.error ?? "indisponible");
      return;
    }

    setLink(body.waLink ?? body.url);
  }

  return (
    <div className="flex flex-col gap-1">
      <button onClick={reveal} className="text-sm underline">
        {type === "whatsapp" ? "Obtenir le lien WhatsApp" : "Voir ma vidéo"}
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
