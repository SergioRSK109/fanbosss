"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui/button-styles";
import { PLATEFORME_LABELS, type PlateformeVerification } from "@/lib/verification";

export interface DemandeVerificationAdmin {
  id: string;
  createurLabel: string;
  plateforme: PlateformeVerification;
  lienCompte: string;
  codeVerification: string;
  statut: "en_attente" | "conflit";
}

function DemandeRow({
  demande,
  pendingId,
  errorMessage,
  onApprouver,
  onRefuser,
}: {
  demande: DemandeVerificationAdmin;
  pendingId: string | null;
  errorMessage: string;
  onApprouver: (id: string) => void;
  onRefuser: (id: string) => void;
}) {
  const t = useTranslations("Admin.verifications");
  const isConflit = demande.statut === "conflit";
  return (
    <li
      className={`card flex flex-col gap-2 px-4 py-3 ${
        isConflit ? "border-2 border-danger-500" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{demande.createurLabel}</span>
        <span className="shrink-0 text-xs text-foreground-muted">
          {PLATEFORME_LABELS[demande.plateforme]}
        </span>
      </div>
      <a
        href={demande.lienCompte}
        target="_blank"
        rel="noreferrer"
        className="truncate text-xs text-brand-600 underline dark:text-brand-300"
      >
        {demande.lienCompte}
      </a>
      <p className="text-xs text-foreground-muted">
        {t("codeAttendu")}{" "}
        <span className="rounded bg-surface-muted px-1.5 py-0.5 font-mono font-semibold">
          {demande.codeVerification}
        </span>
      </p>
      {isConflit && (
        <p className="rounded-2xl border border-danger-500/40 bg-danger-500/10 px-3 py-2 text-xs text-danger-600">
          {t("kycNotice")}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pendingId === demande.id}
          onClick={() => onApprouver(demande.id)}
          className={buttonClass("success", "sm")}
        >
          {pendingId === demande.id ? "..." : t("approuver")}
        </button>
        <button
          type="button"
          disabled={pendingId === demande.id}
          onClick={() => onRefuser(demande.id)}
          className={buttonClass("danger", "sm")}
        >
          {pendingId === demande.id ? "..." : t("refuser")}
        </button>
      </div>
      {errorMessage && <p className="text-sm text-danger-600">{errorMessage}</p>}
    </li>
  );
}

// Two separate lists, per brief: "En attente" (standard review) and
// "Conflits" (visually distinct -- red border, plus the explicit
// KYC-escalation notice) -- see CLAUDE.md "Créateur verification" for
// why no automated resolution exists for conflicts.
export function VerificationsManager({ demandes }: { demandes: DemandeVerificationAdmin[] }) {
  const t = useTranslations("Admin.verifications");
  const tCommon = useTranslations("Common");
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [errorById, setErrorById] = useState<Record<string, string>>({});

  const enAttente = demandes.filter((d) => d.statut === "en_attente");
  const conflits = demandes.filter((d) => d.statut === "conflit");

  async function handleAction(id: string, action: "approuver" | "refuser") {
    setPendingId(id);
    setErrorById((prev) => ({ ...prev, [id]: "" }));

    const response = await fetch(`/api/admin/verification-${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ demandeId: id }),
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

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="mb-2 text-sm font-bold text-foreground-muted">
          {t("enAttenteHeading")} {enAttente.length > 0 && `(${enAttente.length})`}
        </h3>
        {enAttente.length === 0 ? (
          <p className="text-sm text-foreground-muted">{t("noneEnAttente")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {enAttente.map((d) => (
              <DemandeRow
                key={d.id}
                demande={d}
                pendingId={pendingId}
                errorMessage={errorById[d.id] ?? ""}
                onApprouver={(id) => handleAction(id, "approuver")}
                onRefuser={(id) => handleAction(id, "refuser")}
              />
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-bold text-danger-600">
          {t("conflitsHeading")} {conflits.length > 0 && `(${conflits.length})`}
        </h3>
        {conflits.length === 0 ? (
          <p className="text-sm text-foreground-muted">{t("noneConflits")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {conflits.map((d) => (
              <DemandeRow
                key={d.id}
                demande={d}
                pendingId={pendingId}
                errorMessage={errorById[d.id] ?? ""}
                onApprouver={(id) => handleAction(id, "approuver")}
                onRefuser={(id) => handleAction(id, "refuser")}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
