"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass } from "@/components/ui/button-styles";
import { inputClass, labelClass } from "@/components/ui/field-styles";
import { PUBLICATION_CONTENU_MAX_LENGTH } from "@/lib/validation";

// Visible only when the caller is an admin or a créateur_verifie (checked
// server-side by the page rendering this, per the brief) -- but
// publier_message() re-checks the exact same rule again at insert time
// (migration 0029), so this component being reachable at all is never
// the only thing standing between an unauthorized caller and posting.
export function PublicationComposer() {
  const t = useTranslations("Publications.composer");
  const router = useRouter();
  const [contenu, setContenu] = useState("");
  const [visibilite, setVisibilite] = useState<"public" | "soutiens">("public");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const trimmed = contenu.trim();
  const canSubmit =
    trimmed.length > 0 && trimmed.length <= PUBLICATION_CONTENU_MAX_LENGTH && status !== "saving";

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("saving");
    setErrorMessage("");

    try {
      let imageR2Key: string | null = null;

      if (file) {
        const uploadUrlResponse = await fetch("/api/publications/upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contentType: file.type }),
        });
        const uploadUrlBody = await uploadUrlResponse.json();
        if (!uploadUrlResponse.ok) {
          throw new Error(uploadUrlBody.error ?? t("unknownError"));
        }

        const putResponse = await fetch(uploadUrlBody.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!putResponse.ok) {
          throw new Error(`${t("uploadError")} (HTTP ${putResponse.status})`);
        }
        imageR2Key = uploadUrlBody.r2Key;
      }

      const response = await fetch("/api/publications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contenu: trimmed, image_r2_key: imageR2Key, visibilite }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(typeof body.error === "string" ? body.error : t("unknownError"));
      }

      setContenu("");
      setFile(null);
      setVisibilite("public");
      setStatus("idle");
      router.refresh();
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : t("unknownError"));
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card flex flex-col gap-3 p-4">
      <label className={labelClass}>
        <span>{t("contenuLabel")}</span>
        <textarea
          value={contenu}
          onChange={(event) => setContenu(event.target.value)}
          maxLength={PUBLICATION_CONTENU_MAX_LENGTH}
          rows={3}
          placeholder={t("contenuPlaceholder")}
          className={`${inputClass} w-full resize-none`}
        />
      </label>
      <p className="self-end text-xs text-foreground-muted">
        {trimmed.length}/{PUBLICATION_CONTENU_MAX_LENGTH}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept="image/*"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          className="text-sm text-foreground-muted file:mr-2 file:rounded-full file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-brand-600 dark:file:bg-white/10 dark:file:text-brand-300"
        />

        <select
          value={visibilite}
          onChange={(event) => setVisibilite(event.target.value as "public" | "soutiens")}
          className={`${inputClass} w-auto`}
        >
          <option value="public">{t("visibilitePublic")}</option>
          <option value="soutiens">{t("visibiliteSoutiens")}</option>
        </select>

        <button
          type="submit"
          disabled={!canSubmit}
          className={`${buttonClass("primary", "sm")} ml-auto`}
        >
          {status === "saving" ? t("sending") : t("submit")}
        </button>
      </div>

      {status === "error" && <p className="text-sm text-danger-600">{errorMessage}</p>}
    </form>
  );
}
