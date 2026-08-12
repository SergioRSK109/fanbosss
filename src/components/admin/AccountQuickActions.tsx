"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass } from "@/components/ui/button-styles";
import { inputClass } from "@/components/ui/field-styles";

export type StatutCompte = "actif" | "suspendu" | "banni";

const ENDPOINT_BY_ACTION: Record<"suspendre" | "bannir" | "reactiver", string> = {
  suspendre: "/api/admin/suspendre-compte",
  bannir: "/api/admin/bannir-compte",
  reactiver: "/api/admin/reactiver-compte",
};

// Account suspension/ban (migration 0052) -- one shared, self-contained
// action set, reused both by GestionComptesManager (the dedicated
// pseudo-search tool) and as "quick actions" dropped straight into
// LitigesManager/PublicationsSignaleesManager rows, per explicit
// instruction: an admin who already has a problematic account's row in
// front of them shouldn't have to re-type its pseudo into a second tool.
// Same per-instance pendingAction/error pattern as every other admin
// *Manager in this project, router.refresh() on success so a status
// change is reflected via the page's own fresh server data.
export function AccountQuickActions({
  userId,
  currentStatus,
}: {
  userId: string;
  currentStatus: StatutCompte;
}) {
  const t = useTranslations("Admin.gestionComptes");
  const tCommon = useTranslations("Common");
  const router = useRouter();
  const [raison, setRaison] = useState("");
  const [pendingAction, setPendingAction] = useState<"suspendre" | "bannir" | "reactiver" | null>(
    null,
  );
  const [error, setError] = useState("");

  async function handle(action: "suspendre" | "bannir" | "reactiver") {
    setPendingAction(action);
    setError("");

    const response = await fetch(ENDPOINT_BY_ACTION[action], {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action === "reactiver" ? { userId } : { userId, raison }),
    });
    const body = await response.json();

    if (!response.ok) {
      setError(body.error ?? tCommon("unknownError"));
      setPendingAction(null);
      return;
    }

    setPendingAction(null);
    router.refresh();
  }

  const disabled = pendingAction !== null;

  return (
    <div className="flex flex-col gap-2">
      {currentStatus !== "banni" && (
        <input
          type="text"
          value={raison}
          onChange={(event) => setRaison(event.target.value)}
          placeholder={t("raisonPlaceholder")}
          className={`${inputClass} w-full`}
        />
      )}
      <div className="flex flex-wrap gap-2">
        {currentStatus === "actif" && (
          <>
            <button
              type="button"
              disabled={disabled}
              onClick={() => handle("suspendre")}
              className={buttonClass("outline", "sm")}
            >
              {pendingAction === "suspendre" ? tCommon("saving") : t("quickSuspendre")}
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => handle("bannir")}
              className={buttonClass("danger", "sm")}
            >
              {pendingAction === "bannir" ? tCommon("saving") : t("quickBannir")}
            </button>
          </>
        )}
        {currentStatus === "suspendu" && (
          <>
            <button
              type="button"
              disabled={disabled}
              onClick={() => handle("bannir")}
              className={buttonClass("danger", "sm")}
            >
              {pendingAction === "bannir" ? tCommon("saving") : t("quickBannir")}
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => handle("reactiver")}
              className={buttonClass("success", "sm")}
            >
              {pendingAction === "reactiver" ? tCommon("saving") : t("quickReactiver")}
            </button>
          </>
        )}
        {currentStatus === "banni" && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => handle("reactiver")}
            className={buttonClass("success", "sm")}
          >
            {pendingAction === "reactiver" ? tCommon("saving") : t("quickReactiver")}
          </button>
        )}
      </div>
      {error && <p className="text-sm text-danger-600">{error}</p>}
    </div>
  );
}
