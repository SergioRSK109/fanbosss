"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass } from "@/components/ui/button-styles";
import { inputClass } from "@/components/ui/field-styles";
import { RETRAIT_MONTANT_MINIMUM } from "@/lib/wallet";

// Lot 2b: the $25 minimum shown/enforced here is purely a UX convenience
// -- demander_retrait() (migration 0027) re-verifies both the minimum and
// the real available balance server-side regardless of what this form
// sends, the same "never trust a client-computed amount" discipline as
// every other money-related check in this codebase.
export function RetraitRequestForm({ netARetirer }: { netARetirer: number }) {
  const t = useTranslations("Finance.retraitForm");
  const router = useRouter();
  const [montant, setMontant] = useState(
    netARetirer >= RETRAIT_MONTANT_MINIMUM ? String(netARetirer) : "",
  );
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const eligible = netARetirer >= RETRAIT_MONTANT_MINIMUM;
  const parsedMontant = Number(montant);
  const canSubmit =
    eligible &&
    status !== "saving" &&
    Number.isFinite(parsedMontant) &&
    parsedMontant >= RETRAIT_MONTANT_MINIMUM &&
    parsedMontant <= netARetirer;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("saving");
    setErrorMessage("");

    const response = await fetch("/api/wallet/demander-retrait", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ montant: parsedMontant }),
    });
    const body = await response.json();

    if (!response.ok) {
      setStatus("error");
      setErrorMessage(body.error ?? t("unknownError"));
      return;
    }

    setStatus("saved");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      {!eligible && <p className="text-sm text-foreground-muted">{t("threshold")}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="number"
          min={RETRAIT_MONTANT_MINIMUM}
          max={netARetirer}
          step="0.01"
          value={montant}
          onChange={(event) => setMontant(event.target.value)}
          disabled={!eligible}
          className={`${inputClass} w-32`}
          aria-label={t("montantLabel")}
        />
        <button type="submit" disabled={!canSubmit} className={buttonClass("primary", "sm")}>
          {status === "saving" ? t("sending") : t("submit")}
        </button>
      </div>
      {status === "saved" && <p className="text-sm text-success-600">{t("success")}</p>}
      {status === "error" && <p className="text-sm text-danger-600">{errorMessage}</p>}
    </form>
  );
}
