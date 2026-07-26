"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass } from "@/components/ui/button-styles";
import { inputClass, labelClass } from "@/components/ui/field-styles";
import {
  PLATEFORMES_VERIFICATION,
  PLATEFORME_LABELS,
  type PlateformeVerification,
} from "@/lib/verification";

interface DemandeActuelle {
  plateforme: PlateformeVerification;
  lienCompte: string;
  codeVerification: string;
  statut: "en_attente" | "conflit";
}

// Standalone card on /parametres, independent of ParametresForm's own
// save flow -- same "each concern saves/acts on its own" principle as
// the pseudo/bio blocks there. Three states, in priority order:
// already verified, a request already in flight (code never
// regenerated on reload -- it's read straight from the stored row, not
// re-issued), or the request form.
export function VerificationForm({
  nomAffichage,
  createurVerifie,
  demandeActuelle,
}: {
  nomAffichage: string | null;
  createurVerifie: boolean;
  demandeActuelle: DemandeActuelle | null;
}) {
  const t = useTranslations("Verification");
  const tCommon = useTranslations("Common");
  const router = useRouter();
  const [plateforme, setPlateforme] = useState<PlateformeVerification>("tiktok");
  const [lienCompte, setLienCompte] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("saving");
    setErrorMessage("");

    const response = await fetch("/api/verification/demander", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plateforme, lien_compte: lienCompte.trim() }),
    });
    const body = await response.json();

    if (!response.ok) {
      setStatus("error");
      setErrorMessage(typeof body.error === "string" ? body.error : tCommon("unknownError"));
      return;
    }

    setStatus("idle");
    router.refresh();
  }

  if (createurVerifie) {
    return (
      <section className="card flex items-center gap-2 px-4 py-4">
        <span aria-hidden>✓</span>
        <p className="text-sm font-semibold">{t("alreadyVerified")}</p>
      </section>
    );
  }

  if (demandeActuelle) {
    return (
      <section className="card flex flex-col gap-2 px-4 py-4">
        <h2 className="text-sm font-bold text-foreground-muted">{t("heading")}</h2>
        <p className="text-sm">
          {t.rich("pendingIntro", {
            plateforme: PLATEFORME_LABELS[demandeActuelle.plateforme],
            strong: (chunks) => <strong>{chunks}</strong>,
            link: (chunks) => (
              <a
                href={demandeActuelle.lienCompte}
                target="_blank"
                rel="noreferrer"
                className="text-brand-600 underline dark:text-brand-300"
              >
                {chunks}
              </a>
            ),
          })}
        </p>
        <p className="text-sm">
          {t("addCodeInstruction", { plateforme: PLATEFORME_LABELS[demandeActuelle.plateforme] })}{" "}
          <span className="rounded bg-surface-muted px-2 py-0.5 font-mono font-bold">
            {demandeActuelle.codeVerification}
          </span>
        </p>
        {demandeActuelle.statut === "conflit" ? (
          <p className="rounded-2xl border border-danger-500/40 bg-danger-500/10 px-3 py-2 text-sm text-danger-600">
            {t("conflictNotice")}
          </p>
        ) : (
          <p className="text-sm text-foreground-muted">{t("pendingNotice")}</p>
        )}
      </section>
    );
  }

  return (
    <section className="card flex flex-col gap-3 px-4 py-4">
      <h2 className="text-sm font-bold text-foreground-muted">{t("heading")}</h2>
      {!nomAffichage ? (
        <p className="text-sm text-foreground-muted">{t("noDisplayName")}</p>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className={labelClass}>
            <span>{t("platformLabel")}</span>
            <select
              value={plateforme}
              onChange={(event) => setPlateforme(event.target.value as PlateformeVerification)}
              className={`${inputClass} w-full`}
            >
              {PLATEFORMES_VERIFICATION.map((p) => (
                <option key={p} value={p}>
                  {PLATEFORME_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            <span>{t("lienCompteLabel")}</span>
            <input
              type="url"
              required
              value={lienCompte}
              onChange={(event) => setLienCompte(event.target.value)}
              placeholder="https://..."
              className={`${inputClass} w-full`}
            />
          </label>
          {status === "error" && <p className="text-sm text-danger-600">{errorMessage}</p>}
          <button
            type="submit"
            disabled={status === "saving"}
            className={buttonClass("outline", "sm", "self-start")}
          >
            {status === "saving" ? t("sending") : t("submitLabel")}
          </button>
        </form>
      )}
    </section>
  );
}
