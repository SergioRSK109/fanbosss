"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass } from "@/components/ui/button-styles";
import { inputClass } from "@/components/ui/field-styles";

export interface DemandeRetraitAdmin {
  id: string;
  montant: number;
  demandeAt: string;
  createurLabel: string;
}

function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Lot 2b: withdrawal requests (migration 0027) -- same client-side
// pattern as LitigesManager (per-row pendingId/errorById/noteById,
// router.refresh() on success so a handled request disappears via the
// page's own fresh query, not local state). Oldest first, same
// "longest-overdue surfaces first" principle as the other admin
// worklists. "Marquer traité" means a real manual transfer already
// happened outside this app -- there is still no automated payout
// anywhere in this codebase.
export function RetraitsManager({ demandes }: { demandes: DemandeRetraitAdmin[] }) {
  const t = useTranslations("Admin.retraits");
  const tCommon = useTranslations("Common");
  const locale = useLocale();
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [errorById, setErrorById] = useState<Record<string, string>>({});
  const [noteById, setNoteById] = useState<Record<string, string>>({});

  async function handleTraiter(id: string, decision: "traite" | "refuse") {
    setPendingId(id);
    setErrorById((prev) => ({ ...prev, [id]: "" }));

    const response = await fetch("/api/admin/traiter-retrait", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, decision, note: noteById[id] ?? "" }),
    });
    const body = await response.json();

    if (!response.ok) {
      setErrorById((prev) => ({ ...prev, [id]: body.error ?? tCommon("unknownError") }));
      setPendingId(null);
      return;
    }

    setPendingId(null);
    router.refresh();
  }

  if (demandes.length === 0) {
    return <p className="text-sm text-foreground-muted">{t("empty")}</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {demandes.map((demande) => (
        <li key={demande.id} className="card flex flex-col gap-2 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">
              {demande.montant}$ · {demande.createurLabel}
            </span>
            <span className="shrink-0 text-xs text-foreground-muted">
              {formatDate(demande.demandeAt, locale)}
            </span>
          </div>
          <input
            type="text"
            value={noteById[demande.id] ?? ""}
            onChange={(event) =>
              setNoteById((prev) => ({ ...prev, [demande.id]: event.target.value }))
            }
            placeholder={t("notePlaceholder")}
            className={`${inputClass} w-full`}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pendingId === demande.id}
              onClick={() => handleTraiter(demande.id, "traite")}
              className={buttonClass("success", "sm")}
            >
              {pendingId === demande.id ? tCommon("saving") : t("markTraite")}
            </button>
            <button
              type="button"
              disabled={pendingId === demande.id}
              onClick={() => handleTraiter(demande.id, "refuse")}
              className={buttonClass("danger", "sm")}
            >
              {pendingId === demande.id ? tCommon("saving") : t("refuser")}
            </button>
          </div>
          {errorById[demande.id] && (
            <p className="text-sm text-danger-600">{errorById[demande.id]}</p>
          )}
        </li>
      ))}
    </ul>
  );
}
