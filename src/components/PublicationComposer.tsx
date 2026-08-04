"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass } from "@/components/ui/button-styles";
import { inputClass, labelClass } from "@/components/ui/field-styles";
import { PUBLICATION_CONTENU_MAX_LENGTH } from "@/lib/validation";
import {
  isVideoDurationAllowed,
  MAX_VIDEO_DURATION_SECONDS,
  readVideoDurationSeconds,
} from "@/lib/videoDuration";

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
  const [autoriseRepost, setAutoriseRepost] = useState(true);
  // `file` is only ever an image or a video, never both at once --
  // publications_media_exclusif (migration 0037) is the real guarantee,
  // this component just never has a way to attach a second file anyway
  // (a single native file input, replaced wholesale on every selection).
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "checking" | "saving" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [fileInputKey, setFileInputKey] = useState(0);

  const trimmed = contenu.trim();
  // A publication needs text OR a selected file, never text specifically
  // (migration 0044) -- mirrors publications_contenu_coherent's own "at
  // least one of contenu/image/video" rule.
  const canSubmit =
    (trimmed.length > 0 || file !== null) &&
    trimmed.length <= PUBLICATION_CONTENU_MAX_LENGTH &&
    status !== "saving" &&
    status !== "checking";

  // Video support (additive alongside the existing image upload, migration
  // 0037): checked at file *selection* time, before any upload starts --
  // same real-root-cause reasoning and same 90s cap as
  // LivraisonsEnAttente.tsx's own video-duration check for offer delivery
  // (src/lib/videoDuration.ts). An image needs no such check.
  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setErrorMessage("");
    setFile(null);
    if (!selected) return;

    if (!selected.type.startsWith("video/")) {
      setFile(selected);
      return;
    }

    setStatus("checking");
    try {
      const duration = await readVideoDurationSeconds(selected);
      if (!isVideoDurationAllowed(duration)) {
        setErrorMessage(
          t("dureeTropLongue", { duree: Math.round(duration), max: MAX_VIDEO_DURATION_SECONDS }),
        );
        setStatus("idle");
        setFileInputKey((key) => key + 1);
        return;
      }
      setFile(selected);
      setStatus("idle");
    } catch {
      setErrorMessage(t("lectureImpossible"));
      setStatus("idle");
      setFileInputKey((key) => key + 1);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("saving");
    setErrorMessage("");

    try {
      let imageR2Key: string | null = null;
      let videoR2Key: string | null = null;

      if (file) {
        const uploadUrlResponse = await fetch("/api/publications/upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contentType: file.type, size: file.size }),
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

        if (file.type.startsWith("video/")) {
          videoR2Key = uploadUrlBody.r2Key;
        } else {
          imageR2Key = uploadUrlBody.r2Key;
        }
      }

      const response = await fetch("/api/publications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contenu: trimmed || null,
          image_r2_key: imageR2Key,
          video_r2_key: videoR2Key,
          visibilite,
          // Only meaningful when visibilite is "public" -- a soutiens-only
          // post can never be reposted regardless of this value (see
          // toggler_repost_publication()'s own visibilite check), so there's
          // nothing to send differently when the checkbox is hidden.
          autorise_repost: autoriseRepost ? "tous" : "personne",
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(typeof body.error === "string" ? body.error : t("unknownError"));
      }

      setContenu("");
      setFile(null);
      setFileInputKey((key) => key + 1);
      setVisibilite("public");
      setAutoriseRepost(true);
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
          key={fileInputKey}
          type="file"
          accept="image/*,video/*"
          onChange={handleFileChange}
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

        {/* Only meaningful when visibilite is "public" -- a soutiens-only
            post can never be reposted regardless (toggler_repost_publication()
            rejects any non-public target), so the checkbox is hidden
            rather than shown-but-disabled for that case. */}
        {visibilite === "public" && (
          <label className="flex items-center gap-1.5 text-sm text-foreground-muted">
            <input
              type="checkbox"
              checked={autoriseRepost}
              onChange={(event) => setAutoriseRepost(event.target.checked)}
              className="h-4 w-4 rounded border-border accent-brand-500"
            />
            {t("autoriseRepost")}
          </label>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className={`${buttonClass("primary", "sm")} ml-auto`}
        >
          {status === "saving" ? t("sending") : status === "checking" ? t("checking") : t("submit")}
        </button>
      </div>

      {/* Not gated on status === "error" -- a rejected video duration
          resets status back to "idle" (there's nothing further to
          retry, the field is just cleared), same shape as
          LivraisonsEnAttente.tsx's own errorMessage rendering. */}
      {errorMessage && <p className="text-sm text-danger-600">{errorMessage}</p>}
    </form>
  );
}
