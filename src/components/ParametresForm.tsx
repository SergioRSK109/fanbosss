"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/ui/button-styles";
import { inputClass, labelClass } from "@/components/ui/field-styles";

const SAVED_MESSAGE_TIMEOUT_MS = 3000;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function ParametresForm({
  nomAffichage,
  pseudo,
  pseudoLockedUntil,
  bio,
  lienReseauSocial,
  classementPublic,
  masqueExploration,
  photoUrl,
}: {
  nomAffichage: string | null;
  pseudo: string | null;
  // Computed server-side from pseudo_modifie_at (src/lib/validation.ts) --
  // this component only renders it, the real enforcement is the DB
  // trigger + the /api/profil pre-check.
  pseudoLockedUntil: string | null;
  bio: string | null;
  lienReseauSocial: string | null;
  classementPublic: boolean;
  masqueExploration: boolean;
  photoUrl: string | null;
}) {
  const router = useRouter();
  const [nomAffichageValue, setNomAffichageValue] = useState(nomAffichage ?? "");
  const [pseudoValue, setPseudoValue] = useState(pseudo ?? "");
  const [bioValue, setBioValue] = useState(bio ?? "");
  const [lienValue, setLienValue] = useState(lienReseauSocial ?? "");
  const [classementValue, setClassementValue] = useState(classementPublic);
  const [masqueExplorationValue, setMasqueExplorationValue] = useState(masqueExploration);
  const [file, setFile] = useState<File | null>(null);
  // Forces the (uncontrolled) file input to remount and drop its displayed
  // filename after a successful upload -- browsers don't allow clearing a
  // file input's value any other way, and without this a second click on
  // "Enregistrer" would look like it's re-submitting the same file even
  // though `file` state is already null and no re-upload actually happens.
  const [fileInputKey, setFileInputKey] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showPhotoZoom, setShowPhotoZoom] = useState(false);
  // Read-only-by-default protection against accidental edits (product
  // brief): if there's nothing set yet, there's nothing accidental to
  // protect, so start unlocked straight into the first-time-setup flow.
  const [pseudoUnlocked, setPseudoUnlocked] = useState(!pseudo);
  const [bioUnlocked, setBioUnlocked] = useState(!bio);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  // "Enregistré." shouldn't linger forever: clear it a few seconds after a
  // successful save, or immediately below when the user edits anything.
  useEffect(() => {
    if (status !== "saved") {
      return;
    }
    const timeout = setTimeout(() => setStatus("idle"), SAVED_MESSAGE_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [status]);

  function dismissSavedMessage() {
    if (status === "saved") {
      setStatus("idle");
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("saving");
    setErrorMessage("");

    try {
      const payload: Record<string, unknown> = {
        nom_affichage: nomAffichageValue.trim() || null,
        pseudo: pseudoValue.trim() || null,
        bio: bioValue.trim() || null,
        lien_reseau_social: lienValue.trim() || null,
        classement_public: classementValue,
        masque_exploration: masqueExplorationValue,
      };

      if (file) {
        const uploadUrlResponse = await fetch("/api/profil/photo-upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contentType: file.type }),
        });
        const uploadUrlBody = await uploadUrlResponse.json();
        if (!uploadUrlResponse.ok) {
          throw new Error(uploadUrlBody.error ?? "upload de la photo impossible");
        }

        await fetch(uploadUrlBody.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });

        payload.photo_r2_key = uploadUrlBody.r2Key;
      }

      const response = await fetch("/api/profil", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof body.error === "string" ? body.error : "enregistrement impossible",
        );
      }

      setFile(null);
      setFileInputKey((key) => key + 1);
      setStatus("saved");
      router.refresh();
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "erreur inconnue");
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Photo de profil</span>
          <div className="flex items-center gap-3">
            {photoUrl ? (
              <button
                type="button"
                onClick={() => setShowPhotoZoom(true)}
                aria-label="Agrandir la photo de profil"
                className="shrink-0 rounded-full transition-transform active:scale-95"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photoUrl}
                  alt=""
                  className="h-16 w-16 rounded-full border border-border object-cover"
                />
              </button>
            ) : (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-surface-muted text-2xl">
                🙂
              </div>
            )}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={buttonClass("outline", "sm")}
            >
              Modifier la photo de profil
            </button>
          </div>
          {file && <span className="text-sm text-foreground-muted">{file.name}</span>}
          <input
            ref={fileInputRef}
            key={fileInputKey}
            type="file"
            accept="image/*"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              dismissSavedMessage();
            }}
            className="hidden"
          />
        </div>

        <label className={labelClass}>
          <span>Nom d&apos;affichage</span>
          <input
            type="text"
            value={nomAffichageValue}
            onChange={(event) => {
              setNomAffichageValue(event.target.value);
              dismissSavedMessage();
            }}
            placeholder="ex : Sergio, DJ Sergio..."
            maxLength={60}
            className={`${inputClass} w-full`}
          />
          <span className="text-sm text-foreground-muted">
            Le nom affiché sur ton profil public -- distinct de ton identifiant
            technique ci-dessous.
          </span>
        </label>

        <label className={labelClass}>
          <span>Choisis ton identifiant</span>
          <div className="flex gap-2">
            <input
              type="text"
              value={pseudoValue}
              readOnly={!pseudoUnlocked}
              onChange={(event) => {
                setPseudoValue(event.target.value);
                dismissSavedMessage();
              }}
              placeholder="ex: sergio_123, sergioRSK"
              className={`${inputClass} w-full flex-1 ${
                pseudoUnlocked ? "" : "bg-surface-muted text-foreground-muted"
              }`}
            />
            {!pseudoUnlocked && (
              <button
                type="button"
                disabled={Boolean(pseudoLockedUntil)}
                onClick={() => setPseudoUnlocked(true)}
                className={buttonClass("outline", "sm")}
              >
                Modifier
              </button>
            )}
          </div>
          <span className="text-sm text-foreground-muted">
            Ton lien : fanboss.app/@{pseudoValue || "..."}
          </span>
          {pseudoLockedUntil && (
            <span className="text-sm text-accent-600">
              Modifiable à nouveau à partir du {formatDate(pseudoLockedUntil)}.
            </span>
          )}
        </label>

        <label className={labelClass}>
          <span>Bio</span>
          <textarea
            value={bioValue}
            readOnly={!bioUnlocked}
            onChange={(event) => {
              setBioValue(event.target.value);
              dismissSavedMessage();
            }}
            maxLength={500}
            rows={3}
            className={`${inputClass} w-full ${
              bioUnlocked ? "" : "bg-surface-muted text-foreground-muted"
            }`}
          />
          {!bioUnlocked && (
            <button
              type="button"
              onClick={() => setBioUnlocked(true)}
              className={`${buttonClass("outline", "sm")} self-start`}
            >
              Modifier
            </button>
          )}
        </label>

        <label className={labelClass}>
          <span>Lien réseau social (TikTok, Instagram...)</span>
          <input
            type="url"
            value={lienValue}
            onChange={(event) => {
              setLienValue(event.target.value);
              dismissSavedMessage();
            }}
            placeholder="https://instagram.com/..."
            className={`${inputClass} w-full`}
          />
        </label>

        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={classementValue}
            onChange={(event) => {
              setClassementValue(event.target.checked);
              dismissSavedMessage();
            }}
            className="h-5 w-5 accent-brand-500"
          />
          <span className="text-sm">Apparaître dans les classements publics</span>
        </label>

        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={masqueExplorationValue}
            onChange={(event) => {
              setMasqueExplorationValue(event.target.checked);
              dismissSavedMessage();
            }}
            className="h-5 w-5 accent-brand-500"
          />
          <span className="text-sm">Ne pas apparaître dans l&apos;exploration</span>
        </label>

        {status === "error" && <p className="text-sm text-danger-600">{errorMessage}</p>}
        {status === "saved" && <p className="text-sm text-success-600">Enregistré.</p>}

        <button
          type="submit"
          disabled={status === "saving"}
          className={buttonClass("primary", "lg", "mt-2")}
        >
          {status === "saving" ? "Enregistrement..." : "Enregistrer"}
        </button>
      </form>

      {showPhotoZoom && photoUrl && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Photo de profil agrandie"
          onClick={() => setShowPhotoZoom(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photoUrl}
            alt=""
            onClick={(event) => event.stopPropagation()}
            className="max-h-[80vh] max-w-full rounded-2xl object-contain shadow-2xl"
          />
          <button
            type="button"
            onClick={() => setShowPhotoZoom(false)}
            aria-label="Fermer"
            className="absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm hover:bg-white/25"
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}
