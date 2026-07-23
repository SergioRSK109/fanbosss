"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass } from "@/components/ui/button-styles";
import type { OffreType } from "@/lib/validation";

type Demande = {
  id: string;
  montant: number;
  deadline_acceptation: string | null;
  offres: { type: OffreType } | null;
};

export function DemandesEnAttente({ demandes }: { demandes: Demande[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function respond(id: string, action: "accept" | "refuse") {
    setBusyId(id);
    await fetch(`/api/transactions/${id}/${action}`, { method: "POST" });
    setBusyId(null);
    router.refresh();
  }

  if (demandes.length === 0) {
    return <p className="text-sm text-foreground-muted">Aucune demande en attente.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {demandes.map((demande) => (
        <li
          key={demande.id}
          className="card flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <span className="text-sm">
            {demande.offres?.type} · {demande.montant}$ · à répondre avant{" "}
            {demande.deadline_acceptation
              ? new Date(demande.deadline_acceptation).toLocaleString("fr-FR")
              : "-"}
          </span>
          <span className="flex gap-2">
            <button
              disabled={busyId === demande.id}
              onClick={() => respond(demande.id, "accept")}
              className={buttonClass("success", "sm")}
            >
              Accepter
            </button>
            <button
              disabled={busyId === demande.id}
              onClick={() => respond(demande.id, "refuse")}
              className={buttonClass("danger", "sm")}
            >
              Refuser
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}
