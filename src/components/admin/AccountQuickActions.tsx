"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { buttonClass } from "@/components/ui/button-styles";
import { inputClass } from "@/components/ui/field-styles";

export type StatutCompte = "actif" | "suspendu" | "banni";

type Action = "avertir" | "suspendre" | "bannir" | "reactiver";

const ENDPOINT_BY_ACTION: Record<Action, string> = {
  avertir: "/api/admin/emettre-avertissement",
  suspendre: "/api/admin/suspendre-compte",
  bannir: "/api/admin/bannir-compte",
  reactiver: "/api/admin/reactiver-compte",
};

// Account suspension/ban (migration 0052) + admin warning mechanism
// (migration 0053) -- one shared, self-contained action set, reused by
// GestionComptesManager (the dedicated pseudo-search tool) and as "quick
// actions" dropped straight into LitigesManager/PublicationsSignaleesManager
// rows, per explicit instruction: an admin who already has a problematic
// account's row in front of them shouldn't have to re-type its pseudo
// into a second tool. Same per-instance pendingAction/error pattern as
// every other admin *Manager in this project, router.refresh() on
// success so a status change (or a new avertissement, for
// GestionComptesManager's own history list) is reflected via the page's
// own fresh server data.
//
// "Avertir" is always shown, regardless of currentStatus -- a warning
// never blocks access (migration 0053), so there's no status it doesn't
// make sense for; raison is therefore always potentially needed (avertir
// REQUIRES a non-blank one, unlike suspendre/bannir's optional one), so
// the text field is always rendered too, unlike the previous
// banni-only-hides-it shape.
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
  const [pendingAction, setPendingAction] = useState<Action | null>(null);
  const [error, setError] = useState("");
  const [justWarned, setJustWarned] = useState(false);

  useEffect(() => {
    if (!justWarned) return;
    const timer = setTimeout(() => setJustWarned(false), 2500);
    return () => clearTimeout(timer);
  }, [justWarned]);

  async function handle(action: Action) {
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
    if (action === "avertir") {
      setRaison("");
      setJustWarned(true);
    }
    router.refresh();
  }

  const disabled = pendingAction !== null;
  const raisonBlank = raison.trim() === "";

  return (
    <div className="flex flex-col gap-2">
      <input
        type="text"
        value={raison}
        onChange={(event) => setRaison(event.target.value)}
        placeholder={t("raisonPlaceholder")}
        className={`${inputClass} w-full`}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled || raisonBlank}
          onClick={() => handle("avertir")}
          className={buttonClass("outline", "sm")}
        >
          {pendingAction === "avertir" ? tCommon("saving") : t("quickAvertir")}
        </button>
        {currentStatus === "actif" && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => handle("suspendre")}
            className={buttonClass("outline", "sm")}
          >
            {pendingAction === "suspendre" ? tCommon("saving") : t("quickSuspendre")}
          </button>
        )}
        {currentStatus !== "banni" && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => handle("bannir")}
            className={buttonClass("danger", "sm")}
          >
            {pendingAction === "bannir" ? tCommon("saving") : t("quickBannir")}
          </button>
        )}
        {currentStatus !== "actif" && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => handle("reactiver")}
            className={buttonClass("success", "sm")}
          >
            {pendingAction === "reactiver" ? tCommon("saving") : t("quickReactiver")}
          </button>
        )}
        {justWarned && <span className="text-xs text-success-600">{t("avertissementEnvoye")}</span>}
      </div>
      {error && <p className="text-sm text-danger-600">{error}</p>}
    </div>
  );
}
