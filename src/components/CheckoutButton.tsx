"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { buttonClass } from "@/components/ui/button-styles";
import type { OffreType } from "@/lib/validation";

export function CheckoutButton({
  offreId,
  type,
}: {
  offreId: string;
  type: OffreType;
}) {
  const t = useTranslations("CreateurProfile");
  const [montant, setMontant] = useState("3");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const hasFreeAmount = type === "don" || type === "campagne";

  async function handleClick() {
    setLoading(true);
    setErrorMessage("");

    const response = await fetch("/api/transactions/initiate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        offreId,
        montant: hasFreeAmount ? Number(montant) : undefined,
      }),
    });

    const body = await response.json();
    setLoading(false);

    if (!response.ok) {
      setErrorMessage(body.error ?? t("paymentError"));
      return;
    }

    window.location.href = body.paymentUrl;
  }

  return (
    <div className="flex items-center gap-2">
      {hasFreeAmount && (
        <div className="flex items-center gap-1 rounded-full border border-border bg-surface-muted px-3 py-2">
          <span className="text-sm text-foreground-muted">$</span>
          <input
            type="number"
            min={1}
            step="0.01"
            value={montant}
            onChange={(event) => setMontant(event.target.value)}
            className="w-12 bg-transparent text-sm font-semibold outline-none"
          />
        </div>
      )}
      <button
        onClick={handleClick}
        disabled={loading}
        className={buttonClass("primary", "sm")}
      >
        {loading ? t("paying") : t("pay")}
      </button>
      {errorMessage && <p className="text-danger-500 text-xs">{errorMessage}</p>}
    </div>
  );
}
