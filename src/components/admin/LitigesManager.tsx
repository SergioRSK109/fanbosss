"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass } from "@/components/ui/button-styles";
import { inputClass } from "@/components/ui/field-styles";
import {
  computeJoursOuvrablesEcoules,
  computeLitigeUrgence,
  type LitigeUrgence,
} from "@/lib/litiges";
import type { OffreType } from "@/lib/validation";

export interface LitigeEnAttente {
  id: string;
  montant: number;
  offreType: OffreType;
  createdAt: string;
  // Article 6.3 CGU: the 15-business-day commitment is tracked from the
  // moment the fan actually disputed the delivery, not from createdAt
  // (the original payment date, migration 0042). Nullable: a litige
  // disputed before that migration shipped has no real dispute timestamp
  // -- see the urgency badge below for how that's handled.
  contesteAt: string | null;
  createurLabel: string;
  fanLabel: string;
}

const URGENCE_BADGE_CLASS: Record<LitigeUrgence, string> = {
  normal: "bg-foreground-muted/15 text-foreground-muted",
  attention: "bg-accent-500/15 text-accent-600",
  retard: "bg-danger-500/15 text-danger-600",
};

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
// Sorted oldest-dispute-first server-side (by conteste_at, migration
// 0042 -- see admin/page.tsx's query), not created_at (the payment date)
// -- the most urgent litige, per the CGU's own 15-business-day
// commitment, is the one that's been *disputed* longest, not the one
// whose underlying transaction happens to be oldest.
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
      {litiges.map((litige) => {
        const joursOuvrablesEcoules = computeJoursOuvrablesEcoules(litige.contesteAt);
        const urgence = computeLitigeUrgence(joursOuvrablesEcoules);
        return (
          <li key={litige.id} className="card flex flex-col gap-2 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm font-medium">
                {tOffers(litige.offreType)} · {litige.montant}$ · {litige.createurLabel} ←{" "}
                {litige.fanLabel}
              </span>
              <span className="shrink-0 text-xs text-foreground-muted">
                {formatDate(litige.createdAt, locale)}
              </span>
            </div>
            {urgence !== null && joursOuvrablesEcoules !== null && (
              <span
                className={`self-start rounded-full px-2.5 py-1 text-xs font-semibold ${URGENCE_BADGE_CLASS[urgence]}`}
              >
                {t(`urgence.${urgence}`)} ·{" "}
                {t("joursOuvrablesEcoules", { jours: joursOuvrablesEcoules })}
              </span>
            )}
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
            {errorById[litige.id] && (
              <p className="text-sm text-danger-600">{errorById[litige.id]}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
