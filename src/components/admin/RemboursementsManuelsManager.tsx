"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui/button-styles";

export interface RemboursementManuel {
  id: string;
  montant: number;
  createdAt: string;
  createurLabel: string;
  fanLabel: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Oldest first -- this is an operational worklist, not a feed; the
// longest-overdue manual refund should surface first.
export function RemboursementsManuelsManager({
  remboursements,
}: {
  remboursements: RemboursementManuel[];
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [errorById, setErrorById] = useState<Record<string, string>>({});

  async function handleMarquerTraite(id: string) {
    setPendingId(id);
    setErrorById((prev) => ({ ...prev, [id]: "" }));

    const response = await fetch("/api/admin/mark-remboursement-traite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactionId: id }),
    });
    const body = await response.json();

    if (!response.ok) {
      setErrorById((prev) => ({ ...prev, [id]: body.error ?? "erreur inconnue" }));
      setPendingId(null);
      return;
    }

    // router.refresh() re-fetches the server data but does NOT remount this
    // component -- if this row is still present afterward (list unchanged,
    // e.g. nothing else in the list changed keys), pendingId would stay
    // stuck showing the loading state forever without this.
    setPendingId(null);
    router.refresh();
  }

  if (remboursements.length === 0) {
    return <p className="text-sm text-foreground-muted">Aucun remboursement manuel en attente.</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {remboursements.map((r) => (
        <li key={r.id} className="card flex flex-col gap-2 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">
              {r.montant}$ · {r.createurLabel} ← {r.fanLabel}
            </span>
            <span className="shrink-0 text-xs text-foreground-muted">{formatDate(r.createdAt)}</span>
          </div>
          <button
            type="button"
            disabled={pendingId === r.id}
            onClick={() => handleMarquerTraite(r.id)}
            className={buttonClass("outline", "sm", "self-start")}
          >
            {pendingId === r.id ? "Enregistrement..." : "Marquer comme traité"}
          </button>
          {errorById[r.id] && <p className="text-sm text-danger-600">{errorById[r.id]}</p>}
        </li>
      ))}
    </ul>
  );
}
