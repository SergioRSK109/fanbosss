"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass } from "@/components/ui/button-styles";
import { inputClass } from "@/components/ui/field-styles";

type Commande = {
  id: string;
  montant: number;
  quantite: number;
  adresse_livraison: string | null;
  offres: { libelle: string | null } | null;
};

// Phase 2 of the produit physique offer type -- the créateur-facing
// counterpart to livrer_produit() (migration 0040). Deliberately its own
// component, not a reuse/extension of LivraisonsEnAttente.tsx: a physical
// shipment needs an address display and an optional plain-text tracking
// reference, never a file upload, so the interaction shape is genuinely
// different, not just a filtered variant of the same form.
function CommandeRow({ commande, onExpediee }: { commande: Commande; onExpediee: () => void }) {
  const t = useTranslations("Dashboard.commandes");
  const [referenceSuivi, setReferenceSuivi] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("saving");
    setErrorMessage("");

    try {
      const response = await fetch(`/api/transactions/${commande.id}/livrer-produit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referenceSuivi }),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(typeof body.error === "string" ? body.error : t("echecExpedition"));
      }

      setStatus("idle");
      onExpediee();
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : t("echecExpedition"));
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card flex flex-col gap-2 p-4">
      <span className="text-sm font-medium">
        {t("row", {
          libelle: commande.offres?.libelle ?? "",
          quantite: commande.quantite,
          montant: commande.montant,
        })}
      </span>
      <p className="text-sm text-foreground-muted">
        {t("adresseLabel")}{" "}
        {commande.adresse_livraison ?? t("adresseInconnue")}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder={t("referenceSuiviPlaceholder")}
          value={referenceSuivi}
          onChange={(event) => setReferenceSuivi(event.target.value)}
          disabled={status === "saving"}
          className={`${inputClass} flex-1 min-w-[10rem]`}
        />
        <button
          type="submit"
          disabled={status === "saving"}
          className={buttonClass("primary", "sm")}
        >
          {status === "saving" ? t("envoiEnCours") : t("marquerExpedie")}
        </button>
      </div>
      {errorMessage && <p className="text-sm text-danger-600">{errorMessage}</p>}
    </form>
  );
}

export function CommandesAExpedier({ commandes }: { commandes: Commande[] }) {
  const t = useTranslations("Dashboard.commandes");
  const router = useRouter();

  if (commandes.length === 0) {
    return <p className="text-sm text-foreground-muted">{t("empty")}</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {commandes.map((commande) => (
        <li key={commande.id}>
          <CommandeRow commande={commande} onExpediee={() => router.refresh()} />
        </li>
      ))}
    </ul>
  );
}
