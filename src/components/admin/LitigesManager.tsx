"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass } from "@/components/ui/button-styles";
import { inputClass } from "@/components/ui/field-styles";
import type { OffreType } from "@/lib/validation";

export interface LitigeEnAttente {
  id: string;
  montant: number;
  offreType: OffreType;
  createdAt: string;
  createurLabel: string;
  fanLabel: string;
}

function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Lot 2a-bis: video/shoutout deliveries a fan flagged as a problem
// (migration 0025), now resolvable by an admin (migration 0026) via
// resoudre_litige() -- same client-side pattern as
// RemboursementsManuelsManager (per-row pendingId/error state,
// router.refresh() on success so a resolved litige disappears from the
// list via the parent's fresh server data, not local state -- the
// page's own query already excludes anything with litige_resolu_at set).
// Oldest first, same "longest-overdue surfaces first" principle as the
// manual-refunds list.
export function LitigesManager({ litiges }: { litiges: LitigeEnAttente[] }) {
  const t = useTranslations("Admin.litiges");
  const tCommon = useTranslations("Common");
  const tOffers = useTranslations("CreateurProfile.offerTypes");
  const locale = useLocale();
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [errorById, setErrorById] = useState<Record<string, string>>({});
  const [noteById, setNoteById] = useState<Record<string, string>>({});

  async function handleResoudre(id: string, decision: "faveur_createur" | "faveur_fan") {
    setPendingId(id);
    setErrorById((prev) => ({ ...prev, [id]: "" }));

    const response = await fetch("/api/admin/resoudre-litige", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactionId: id, decision, note: noteById[id] ?? "" }),
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

  if (litiges.length === 0) {
    return <p className="text-sm text-foreground-muted">{t("empty")}</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {litiges.map((litige) => (
        <li key={litige.id} className="card flex flex-col gap-2 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">
              {tOffers(litige.offreType)} · {litige.montant}$ · {litige.createurLabel} ←{" "}
              {litige.fanLabel}
            </span>
            <span className="shrink-0 text-xs text-foreground-muted">
              {formatDate(litige.createdAt, locale)}
            </span>
          </div>
          <input
            type="text"
            value={noteById[litige.id] ?? ""}
            onChange={(event) =>
              setNoteById((prev) => ({ ...prev, [litige.id]: event.target.value }))
            }
            placeholder={t("notePlaceholder")}
            className={`${inputClass} w-full`}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pendingId === litige.id}
              onClick={() => handleResoudre(litige.id, "faveur_createur")}
              className={buttonClass("success", "sm")}
            >
              {pendingId === litige.id ? tCommon("saving") : t("trancherCreateur")}
            </button>
            <button
              type="button"
              disabled={pendingId === litige.id}
              onClick={() => handleResoudre(litige.id, "faveur_fan")}
              className={buttonClass("danger", "sm")}
            >
              {pendingId === litige.id ? tCommon("saving") : t("trancherFan")}
            </button>
          </div>
          {errorById[litige.id] && <p className="text-sm text-danger-600">{errorById[litige.id]}</p>}
        </li>
      ))}
    </ul>
  );
}
