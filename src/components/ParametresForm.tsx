"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CopyProfileLinkButton } from "@/components/CopyProfileLinkButton";
import { buttonClass } from "@/components/ui/button-styles";
import { inputClass, labelClass } from "@/components/ui/field-styles";
import { ZoomablePhoto } from "@/components/ui/ZoomablePhoto";
import { PhotoCropper } from "@/components/PhotoCropper";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { PSEUDO_COOLDOWN_MS } from "@/lib/validation";

const SAVED_MESSAGE_TIMEOUT_MS = 3000;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

async function patchProfil(payload: Record<string, unknown>) {
  const response = await fetch("/api/profil", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json();

  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : "enregistrement impossible");
  }

  return body as { profil: Record<string, unknown> };
}

// Pseudo and bio each save independently of the rest of the form (and of
// each other) -- product brief: unlocking one field via its own
// "Modifier" button must not risk touching any other field. A plain hook
// factory rather than a bigger shared component: the three call sites
// (main form, pseudo, bio) need their own status/error state, but share
// the same "run an async action, track saving/saved/error, auto-clear
// the saved message" shape. `run` takes the action itself (rather than
// always doing a single PATCH internally) so the main form's multi-step
// flow (upload photo, then PATCH) reports into the same error path as
// pseudo/bio's single PATCH.
function useSaveStatus() {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (status !== "saved") {
      return;
    }
    const timeout = setTimeout(() => setStatus("idle"), SAVED_MESSAGE_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [status]);

  function dismiss() {
    if (status === "saved") {
      setStatus("idle");
    }
  }

  async function run<T>(action: () => Promise<T>): Promise<T | null> {
    setStatus("saving");
    setErrorMessage("");

    try {
      const result = await action();
      setStatus("saved");
      router.refresh();
      return result;
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "erreur inconnue");
      return null;
    }
  }

  return { status, errorMessage, run, dismiss };
}

export function ParametresForm({
  nomAffichage,
  pseudo,
  pseudoLockedUntil,
  bio,
  lienTiktok,
  lienInstagram,
  lienYoutube,
  lienAutre,
  classementPublic,
  masqueExploration,
  badgeFidelitePublic,
  photoUrl,
}: {
  nomAffichage: string | null;
  pseudo: string | null;
  // Computed server-side from pseudo_modifie_at (src/lib/validation.ts) --
  // this component only renders it, the real enforcement is the DB
  // trigger + the /api/profil pre-check.
  pseudoLockedUntil: string | null;
  bio: string | null;
  lienTiktok: string | null;
  lienInstagram: string | null;
  lienYoutube: string | null;
  lienAutre: string | null;
  classementPublic: boolean;
  masqueExploration: boolean;
  badgeFidelitePublic: boolean;
  photoUrl: string | null;
}) {
  const [nomAffichageValue, setNomAffichageValue] = useState(nomAffichage ?? "");
  const [lienTiktokValue, setLienTiktokValue] = useState(lienTiktok ?? "");
  const [lienInstagramValue, setLienInstagramValue] = useState(lienInstagram ?? "");
  const [lienYoutubeValue, setLienYoutubeValue] = useState(lienYoutube ?? "");
  const [lienAutreValue, setLienAutreValue] = useState(lienAutre ?? "");
  const [classementValue, setClassementValue] = useState(classementPublic);
  const [masqueExplorationValue, setMasqueExplorationValue] = useState(masqueExploration);
  const [badgeFideliteValue, setBadgeFideliteValue] = useState(badgeFidelitePublic);
  const [file, setFile] = useState<File | null>(null);
  // The raw file straight from the OS picker, before cropping -- opens
  // PhotoCropper when set. Never uploaded directly: `file` (above) only
  // ever gets set to the cropped, re-encoded result once the créateur
  // confirms the crop.
  const [cropFile, setCropFile] = useState<File | null>(null);
  // Forces the (uncontrolled) file input to remount and drop its displayed
  // filename after a successful upload -- browsers don't allow clearing a
  // file input's value any other way, and without this a second click on
  // "Enregistrer" would look like it's re-submitting the same file even
  // though `file` state is already null and no re-upload actually happens.
  const [fileInputKey, setFileInputKey] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Local object URL of the just-cropped blob -- shown in place of the
  // saved photoUrl immediately on crop confirmation (Instagram-style),
  // before "Enregistrer" is ever clicked. Revoked whenever replaced or on
  // unmount by the effect below.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const mainSave = useSaveStatus();
  const isUploadingPhoto = mainSave.status === "saving" && Boolean(file);

  // Pseudo -------------------------------------------------------------
  const pseudoSave = useSaveStatus();
  const [pseudoValue, setPseudoValue] = useState(pseudo ?? "");
  // Read-only-by-default protection against accidental edits (product
  // brief): if there's nothing set yet, there's nothing accidental to
  // protect, so start unlocked straight into the first-time-setup flow.
  const [pseudoUnlocked, setPseudoUnlocked] = useState(!pseudo);
  const [pseudoLockedUntilValue, setPseudoLockedUntilValue] = useState(pseudoLockedUntil);
  const [pseudoJustSavedUntil, setPseudoJustSavedUntil] = useState<string | null>(null);

  async function handlePseudoSave() {
    const result = await pseudoSave.run(() =>
      patchProfil({ pseudo: pseudoValue.trim() || null }),
    );
    if (result) {
      const unlockAt = new Date(Date.now() + PSEUDO_COOLDOWN_MS).toISOString();
      setPseudoLockedUntilValue(unlockAt);
      setPseudoJustSavedUntil(unlockAt);
      setPseudoUnlocked(false);
    }
  }

  // Bio ------------------------------------------------------------------
  const bioSave = useSaveStatus();
  const [bioValue, setBioValue] = useState(bio ?? "");
  const [bioUnlocked, setBioUnlocked] = useState(!bio);

  async function handleBioSave() {
    const result = await bioSave.run(() => patchProfil({ bio: bioValue.trim() || null }));
    if (result) {
      setBioUnlocked(false);
    }
  }

  // Mot de passe ----------------------------------------------------------
  // Unlike pseudo/bio, there's no existing value to display or protect
  // against overwriting -- but the same hidden-until-"Modifier" affordance
  // still guards against an accidental change, so it stays locked by
  // default rather than starting unlocked the way pseudo/bio do for a
  // first-time (empty) value.
  const passwordSave = useSaveStatus();
  const [passwordUnlocked, setPasswordUnlocked] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");

  async function handlePasswordSave() {
    const result = await passwordSave.run(async () => {
      if (newPassword !== confirmNewPassword) {
        throw new Error("Les mots de passe ne correspondent pas.");
      }
      // No previous-password prompt -- the already-active session is what
      // authorizes this on Supabase's side, same as the rest of /parametres.
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        throw new Error(error.message);
      }
      return true;
    });
    if (result) {
      setNewPassword("");
      setConfirmNewPassword("");
      setPasswordUnlocked(false);
    }
  }

  async function handleMainSubmit(event: React.FormEvent) {
    event.preventDefault();

    const result = await mainSave.run(async () => {
      const payload: Record<string, unknown> = {
        nom_affichage: nomAffichageValue.trim() || null,
        lien_tiktok: lienTiktokValue.trim() || null,
        lien_instagram: lienInstagramValue.trim() || null,
        lien_youtube: lienYoutubeValue.trim() || null,
        lien_autre: lienAutreValue.trim() || null,
        classement_public: classementValue,
        masque_exploration: masqueExplorationValue,
        badge_fidelite_public: badgeFideliteValue,
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

        const putResponse = await fetch(uploadUrlBody.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!putResponse.ok) {
          // This response was never checked before -- a failed PUT (bad
          // network, R2 rejecting the request) used to be silently
          // ignored and the profile still got pointed at an r2_key with
          // nothing behind it. Surface exactly what happened instead.
          const detail = await putResponse.text().catch(() => "");
          throw new Error(
            `échec de l'envoi de la photo (HTTP ${putResponse.status})${
              detail ? ` : ${detail.slice(0, 200)}` : ""
            }`,
          );
        }

        payload.photo_r2_key = uploadUrlBody.r2Key;
      }

      return patchProfil(payload);
    });

    if (result) {
      setFile(null);
      setFileInputKey((key) => key + 1);
      // The just-saved photoUrl prop will reflect the real uploaded photo
      // once router.refresh() (inside mainSave.run) re-renders this from
      // the server -- the local preview has done its job.
      setPreviewUrl(null);
    }
  }

  function handleCropCancel() {
    setCropFile(null);
    setFileInputKey((key) => key + 1);
  }

  function handleCropConfirm(blob: Blob) {
    // Instagram-style: show the new photo immediately, before
    // "Enregistrer" is even clicked, instead of a silent change once the
    // upload finishes.
    setPreviewUrl(URL.createObjectURL(blob));
    setFile(new File([blob], "profil.jpg", { type: "image/jpeg" }));
    setCropFile(null);
    setFileInputKey((key) => key + 1);
    mainSave.dismiss();
  }

  return (
    <>
      {cropFile && (
        <PhotoCropper file={cropFile} onCancel={handleCropCancel} onConfirm={handleCropConfirm} />
      )}

      <form onSubmit={handleMainSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Photo de profil</span>
          <div className="flex items-center gap-3">
            {previewUrl ?? photoUrl ? (
              <div className="relative shrink-0">
                <ZoomablePhoto
                  src={(previewUrl ?? photoUrl)!}
                  ariaLabel="Agrandir la photo de profil"
                  thumbnailClassName={`h-16 w-16 rounded-full border border-border object-cover transition-opacity ${
                    isUploadingPhoto ? "opacity-40" : ""
                  }`}
                />
                {isUploadingPhoto && (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 flex items-center justify-center"
                  >
                    <span className="h-6 w-6 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
                  </div>
                )}
              </div>
            ) : (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-surface-muted text-2xl">
                🙂
              </div>
            )}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploadingPhoto}
              className={buttonClass("outline", "sm")}
            >
              Modifier la photo de profil
            </button>
          </div>
          {file && !isUploadingPhoto && (
            <span className="text-sm text-foreground-muted">
              Nouvelle photo prête à enregistrer.
            </span>
          )}
          {isUploadingPhoto && (
            <span className="text-sm text-foreground-muted">Envoi de la photo...</span>
          )}
          <input
            ref={fileInputRef}
            key={fileInputKey}
            type="file"
            accept="image/*"
            onChange={(event) => {
              const selected = event.target.files?.[0];
              if (selected) {
                setCropFile(selected);
              }
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
              mainSave.dismiss();
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

        <div className={labelClass}>
          <span>Liens réseaux sociaux (facultatifs)</span>
          <input
            type="url"
            value={lienTiktokValue}
            onChange={(event) => {
              setLienTiktokValue(event.target.value);
              mainSave.dismiss();
            }}
            placeholder="TikTok -- https://tiktok.com/@..."
            className={`${inputClass} w-full`}
          />
          <input
            type="url"
            value={lienInstagramValue}
            onChange={(event) => {
              setLienInstagramValue(event.target.value);
              mainSave.dismiss();
            }}
            placeholder="Instagram -- https://instagram.com/..."
            className={`${inputClass} w-full`}
          />
          <input
            type="url"
            value={lienYoutubeValue}
            onChange={(event) => {
              setLienYoutubeValue(event.target.value);
              mainSave.dismiss();
            }}
            placeholder="YouTube -- https://youtube.com/@..."
            className={`${inputClass} w-full`}
          />
          <input
            type="url"
            value={lienAutreValue}
            onChange={(event) => {
              setLienAutreValue(event.target.value);
              mainSave.dismiss();
            }}
            placeholder="Autre lien -- https://..."
            className={`${inputClass} w-full`}
          />
        </div>

        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={classementValue}
            onChange={(event) => {
              setClassementValue(event.target.checked);
              mainSave.dismiss();
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
              mainSave.dismiss();
            }}
            className="h-5 w-5 accent-brand-500"
          />
          <span className="text-sm">Ne pas apparaître dans l&apos;exploration</span>
        </label>

        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={badgeFideliteValue}
            onChange={(event) => {
              setBadgeFideliteValue(event.target.checked);
              mainSave.dismiss();
            }}
            className="h-5 w-5 accent-brand-500"
          />
          <span className="text-sm">
            Rendre mes badges de fidélité publics (visibles sur ton profil et
            sur celui des créateurs que tu soutiens)
          </span>
        </label>

        {mainSave.status === "error" && (
          <p className="text-sm text-danger-600">{mainSave.errorMessage}</p>
        )}
        {mainSave.status === "saved" && (
          <p className="text-sm text-success-600">Enregistré.</p>
        )}

        <button
          type="submit"
          disabled={mainSave.status === "saving"}
          className={buttonClass("primary", "lg", "mt-2")}
        >
          {mainSave.status === "saving" ? "Enregistrement..." : "Enregistrer"}
        </button>
      </form>

      {/* Pseudo and bio live outside the main form on purpose: each saves
          independently via its own "Enregistrer" button (product brief),
          not as part of the global submit above. */}
      <div className={`${labelClass} mt-4`}>
        <span>Choisis ton identifiant</span>
        <div className="flex gap-2">
          <input
            type="text"
            value={pseudoValue}
            readOnly={!pseudoUnlocked}
            onChange={(event) => {
              setPseudoValue(event.target.value);
              pseudoSave.dismiss();
            }}
            placeholder="ex: sergio_123, sergioRSK"
            className={`${inputClass} w-full flex-1 ${
              pseudoUnlocked ? "" : "bg-surface-muted text-foreground-muted"
            }`}
          />
          {!pseudoUnlocked && (
            <button
              type="button"
              disabled={Boolean(pseudoLockedUntilValue)}
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
        {/* Uses the saved `pseudo` prop, not the live-editing pseudoValue
            -- copying an unsaved draft would share a link that doesn't
            resolve yet. */}
        {pseudo && <CopyProfileLinkButton pseudo={pseudo} />}
        {pseudoLockedUntilValue && (
          <span className="text-sm text-accent-600">
            Modifiable à nouveau à partir du {formatDate(pseudoLockedUntilValue)}.
          </span>
        )}
        {pseudoUnlocked && (
          <button
            type="button"
            disabled={pseudoSave.status === "saving"}
            onClick={handlePseudoSave}
            className={buttonClass("primary", "sm", "self-start")}
          >
            {pseudoSave.status === "saving" ? "Enregistrement..." : "Enregistrer"}
          </button>
        )}
        {pseudoSave.status === "error" && (
          <p className="text-sm text-danger-600">{pseudoSave.errorMessage}</p>
        )}
        {pseudoSave.status === "saved" && pseudoJustSavedUntil && (
          <p className="text-sm text-success-600">
            Pseudo enregistré. Tu pourras le remodifier à partir du{" "}
            {formatDate(pseudoJustSavedUntil)}.
          </p>
        )}
      </div>

      <div className={`${labelClass} mt-4`}>
        <span>Bio</span>
        <textarea
          value={bioValue}
          readOnly={!bioUnlocked}
          onChange={(event) => {
            setBioValue(event.target.value);
            bioSave.dismiss();
          }}
          maxLength={500}
          rows={4}
          className={`${inputClass} w-full resize-none ${
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
        {bioUnlocked && (
          <button
            type="button"
            disabled={bioSave.status === "saving"}
            onClick={handleBioSave}
            className={buttonClass("primary", "sm", "self-start")}
          >
            {bioSave.status === "saving" ? "Enregistrement..." : "Enregistrer"}
          </button>
        )}
        {bioSave.status === "error" && (
          <p className="text-sm text-danger-600">{bioSave.errorMessage}</p>
        )}
        {bioSave.status === "saved" && (
          <p className="text-sm text-success-600">Bio enregistrée.</p>
        )}
      </div>

      <div className={`${labelClass} mt-4`}>
        <span>Mot de passe</span>
        {!passwordUnlocked ? (
          <button
            type="button"
            onClick={() => setPasswordUnlocked(true)}
            className={`${buttonClass("outline", "sm")} self-start`}
          >
            Modifier le mot de passe
          </button>
        ) : (
          <>
            <input
              type="password"
              value={newPassword}
              onChange={(event) => {
                setNewPassword(event.target.value);
                passwordSave.dismiss();
              }}
              placeholder="Nouveau mot de passe"
              minLength={8}
              className={`${inputClass} w-full`}
            />
            <input
              type="password"
              value={confirmNewPassword}
              onChange={(event) => {
                setConfirmNewPassword(event.target.value);
                passwordSave.dismiss();
              }}
              placeholder="Confirmer le nouveau mot de passe"
              minLength={8}
              className={`${inputClass} w-full`}
            />
            <button
              type="button"
              disabled={passwordSave.status === "saving"}
              onClick={handlePasswordSave}
              className={buttonClass("primary", "sm", "self-start")}
            >
              {passwordSave.status === "saving" ? "Enregistrement..." : "Enregistrer"}
            </button>
          </>
        )}
        {passwordSave.status === "error" && (
          <p className="text-sm text-danger-600">{passwordSave.errorMessage}</p>
        )}
        {passwordSave.status === "saved" && (
          <p className="text-sm text-success-600">Mot de passe modifié.</p>
        )}
      </div>
    </>
  );
}
