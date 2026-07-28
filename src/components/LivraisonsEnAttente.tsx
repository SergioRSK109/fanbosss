"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass } from "@/components/ui/button-styles";
import type { OffreType } from "@/lib/validation";
import {
  isVideoDurationAllowed,
  MAX_VIDEO_DURATION_SECONDS,
  readVideoDurationSeconds,
} from "@/lib/videoDuration";

type Livraison = {
  id: string;
  montant: number;
  deadline_livraison: string | null;
  offres: { type: OffreType; libelle: string | null } | null;
};

// Security audit fix: this whole component is new -- créateur-facing
// UI for delivering an accepted video/shoutout transaction never existed
// before (the backend, /api/transactions/[id]/upload-url +
// deliver_video(), was already there, but nothing in the app ever called
// it -- confirmed by grepping the entire src/ tree before building this).
// Same repeatable-row pattern as DemandesEnAttente.tsx, one row per
// `validee` video/shoutout transaction still awaiting its file.
function LivraisonRow({
  livraison,
  onDelivered,
}: {
  livraison: Livraison;
  onDelivered: () => void;
}) {
  const t = useTranslations("Dashboard.livraisons");
  const locale = useLocale();
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "checking" | "uploading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  // Checked the moment a file is picked, before any upload ever starts --
  // this is the actual security fix: reading the video's own metadata
  // (duration) in the browser rejects an overly long file at its real
  // root cause, rather than only catching it as an oversized upload after
  // the fact (see checkUploadSize()/getSignedUploadUrl() in src/lib/r2.ts
  // for that safety net).
  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setErrorMessage("");
    setFile(null);
    if (!selected) return;

    setStatus("checking");
    try {
      const duration = await readVideoDurationSeconds(selected);
      if (!isVideoDurationAllowed(duration)) {
        setErrorMessage(
          t("dureeTropLongue", {
            duree: Math.round(duration),
            max: MAX_VIDEO_DURATION_SECONDS,
          }),
        );
        setStatus("idle");
        event.target.value = "";
        return;
      }
      setFile(selected);
      setStatus("idle");
    } catch {
      setErrorMessage(t("lectureImpossible"));
      setStatus("idle");
      event.target.value = "";
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    setStatus("uploading");
    setErrorMessage("");

    try {
      const uploadUrlResponse = await fetch(`/api/transactions/${livraison.id}/upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ size: file.size }),
      });
      const uploadUrlBody = await uploadUrlResponse.json();
      if (!uploadUrlResponse.ok) {
        // Real server-side rejection (checkUploadSize() in src/lib/r2.ts)
        // surfaces here too -- the client-side duration check above is
        // never the only thing standing between an oversized file and a
        // real upload.
        throw new Error(uploadUrlBody.error ?? t("uploadImpossible"));
      }

      const putResponse = await fetch(uploadUrlBody.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "video/mp4" },
        body: file,
      });
      if (!putResponse.ok) {
        throw new Error(`${t("uploadImpossible")} (HTTP ${putResponse.status})`);
      }

      const deliverResponse = await fetch(`/api/transactions/${livraison.id}/deliver`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ r2Key: uploadUrlBody.r2Key }),
      });
      const deliverBody = await deliverResponse.json();
      if (!deliverResponse.ok) {
        throw new Error(deliverBody.error ?? t("livraisonImpossible"));
      }

      setStatus("idle");
      setFile(null);
      onDelivered();
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : t("livraisonImpossible"));
    }
  }

  const offre = livraison.offres;
  const typeEtLibelle = offre?.libelle ? `${offre.type} – ${offre.libelle}` : (offre?.type ?? "");
  const busy = status === "checking" || status === "uploading";

  return (
    <form onSubmit={handleSubmit} className="card flex flex-col gap-2 p-4">
      <span className="text-sm">
        {t("row", {
          type: typeEtLibelle,
          montant: livraison.montant,
          date: livraison.deadline_livraison
            ? new Date(livraison.deadline_livraison).toLocaleString(locale)
            : "-",
        })}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="file"
          accept="video/*"
          onChange={handleFileChange}
          disabled={busy}
          className="text-sm text-foreground-muted file:mr-2 file:rounded-full file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-brand-600 dark:file:bg-white/10 dark:file:text-brand-300"
        />
        <button
          type="submit"
          disabled={!file || busy}
          className={buttonClass("primary", "sm")}
        >
          {status === "uploading" ? t("envoiEnCours") : t("livrer")}
        </button>
      </div>
      {errorMessage && <p className="text-sm text-danger-600">{errorMessage}</p>}
    </form>
  );
}

export function LivraisonsEnAttente({ livraisons }: { livraisons: Livraison[] }) {
  const t = useTranslations("Dashboard.livraisons");
  const router = useRouter();

  if (livraisons.length === 0) {
    return <p className="text-sm text-foreground-muted">{t("empty")}</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {livraisons.map((livraison) => (
        <li key={livraison.id}>
          <LivraisonRow livraison={livraison} onDelivered={() => router.refresh()} />
        </li>
      ))}
    </ul>
  );
}
