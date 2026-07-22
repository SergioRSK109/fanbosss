"use client";

import { useState } from "react";

export function CheckoutButton({
  offreId,
  type,
}: {
  offreId: string;
  type: "video" | "don" | "whatsapp";
}) {
  const [montant, setMontant] = useState("3");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function handleClick() {
    setLoading(true);
    setErrorMessage("");

    const response = await fetch("/api/transactions/initiate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        offreId,
        montant: type === "don" ? Number(montant) : undefined,
      }),
    });

    const body = await response.json();
    setLoading(false);

    if (!response.ok) {
      setErrorMessage(body.error ?? "paiement impossible");
      return;
    }

    window.location.href = body.paymentUrl;
  }

  return (
    <div className="flex items-center gap-2">
      {type === "don" && (
        <input
          type="number"
          min={1}
          step="0.01"
          value={montant}
          onChange={(event) => setMontant(event.target.value)}
          className="border rounded px-2 py-1 w-20"
        />
      )}
      <button
        onClick={handleClick}
        disabled={loading}
        className="bg-violet-600 text-white rounded px-3 py-2 disabled:opacity-50"
      >
        {loading ? "..." : "Payer"}
      </button>
      {errorMessage && <p className="text-red-600 text-sm">{errorMessage}</p>}
    </div>
  );
}
