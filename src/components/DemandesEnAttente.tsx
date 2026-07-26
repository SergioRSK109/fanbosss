"use client";

import { useLocale, useTranslations } from "next-intl";
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
  const t = useTranslations("Dashboard.demandes");
  const locale = useLocale();
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function respond(id: string, action: "accept" | "refuse") {
    setBusyId(id);
    await fetch(`/api/transactions/${id}/${action}`, { method: "POST" });
    setBusyId(null);
    router.refresh();
  }

  if (demandes.length === 0) {
    return <p className="text-sm text-foreground-muted">{t("empty")}</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {demandes.map((demande) => (
        <li
          key={demande.id}
          className="card flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <span className="text-sm">
            {t("row", {
              type: demande.offres?.type ?? "",
              montant: demande.montant,
              date: demande.deadline_acceptation
                ? new Date(demande.deadline_acceptation).toLocaleString(locale)
                : "-",
            })}
          </span>
          <span className="flex gap-2">
            <button
              disabled={busyId === demande.id}
              onClick={() => respond(demande.id, "accept")}
              className={buttonClass("success", "sm")}
            >
              {t("accept")}
            </button>
            <button
              disabled={busyId === demande.id}
              onClick={() => respond(demande.id, "refuse")}
              className={buttonClass("danger", "sm")}
            >
              {t("refuse")}
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}
