"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const SAVED_MESSAGE_TIMEOUT_MS = 3000;

export function ParametresForm({
  pseudo,
  bio,
  lienReseauSocial,
  classementPublic,
  photoUrl,
}: {
  pseudo: string | null;
  bio: string | null;
  lienReseauSocial: string | null;
  classementPublic: boolean;
  photoUrl: string | null;
}) {
  const router = useRouter();
  const [pseudoValue, setPseudoValue] = useState(pseudo ?? "");
  const [bioValue, setBioValue] = useState(bio ?? "");
  const [lienValue, setLienValue] = useState(lienReseauSocial ?? "");
  const [classementValue, setClassementValue] = useState(classementPublic);
  const [file, setFile] = useState<File | null>(null);
  // Forces the (uncontrolled) file input to remount and drop its displayed
  // filename after a successful upload -- browsers don't allow clearing a
  // file input's value any other way, and without this a second click on
  // "Enregistrer" would look like it's re-submitting the same file even
  // though `file` state is already null and no re-upload actually happens.
  const [fileInputKey, setFileInputKey] = useState(0);
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
        pseudo: pseudoValue.trim() || null,
        bio: bioValue.trim() || null,
        lien_reseau_social: lienValue.trim() || null,
        classement_public: classementValue,
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
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span>Photo de profil</span>
        {photoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoUrl}
            alt=""
            className="w-16 h-16 rounded-full object-cover border mb-1"
          />
        )}
        <input
          key={fileInputKey}
          type="file"
          accept="image/*"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            dismissSavedMessage();
          }}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span>Choisis ton identifiant</span>
        <input
          type="text"
          value={pseudoValue}
          onChange={(event) => {
            setPseudoValue(event.target.value);
            dismissSavedMessage();
          }}
          placeholder="ex: sergio_123, sergioRSK"
          className="border rounded px-3 py-2"
        />
        <span className="text-sm text-gray-500">
          Ton lien : fanboss.app/@{pseudoValue || "..."}
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span>Bio</span>
        <textarea
          value={bioValue}
          onChange={(event) => {
            setBioValue(event.target.value);
            dismissSavedMessage();
          }}
          maxLength={500}
          rows={3}
          className="border rounded px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span>Lien réseau social (TikTok, Instagram...)</span>
        <input
          type="url"
          value={lienValue}
          onChange={(event) => {
            setLienValue(event.target.value);
            dismissSavedMessage();
          }}
          placeholder="https://instagram.com/..."
          className="border rounded px-3 py-2"
        />
      </label>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={classementValue}
          onChange={(event) => {
            setClassementValue(event.target.checked);
            dismissSavedMessage();
          }}
        />
        <span>Apparaître dans les classements publics</span>
      </label>

      {status === "error" && <p className="text-red-600 text-sm">{errorMessage}</p>}
      {status === "saved" && <p className="text-green-600 text-sm">Enregistré.</p>}

      <button
        type="submit"
        disabled={status === "saving"}
        className="bg-violet-600 text-white rounded px-3 py-2 disabled:opacity-50"
      >
        {status === "saving" ? "Enregistrement..." : "Enregistrer"}
      </button>
    </form>
  );
}
