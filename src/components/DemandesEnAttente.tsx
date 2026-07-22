"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
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
    return <p>Aucune demande en attente.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {demandes.map((demande) => (
        <li
          key={demande.id}
          className="border rounded px-3 py-2 flex items-center justify-between gap-4"
        >
          <span>
            {demande.offres?.type} - {demande.montant}$ - à répondre avant{" "}
            {demande.deadline_acceptation
              ? new Date(demande.deadline_acceptation).toLocaleString("fr-FR")
              : "-"}
          </span>
          <span className="flex gap-2">
            <button
              disabled={busyId === demande.id}
              onClick={() => respond(demande.id, "accept")}
              className="bg-green-600 text-white rounded px-3 py-1 text-sm disabled:opacity-50"
            >
              Accepter
            </button>
            <button
              disabled={busyId === demande.id}
              onClick={() => respond(demande.id, "refuse")}
              className="bg-red-600 text-white rounded px-3 py-1 text-sm disabled:opacity-50"
            >
              Refuser
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}
