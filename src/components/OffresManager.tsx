"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Link } from "@/i18n/navigation";
import { buttonClass } from "@/components/ui/button-styles";
import { inputClass } from "@/components/ui/field-styles";
import { WHATSAPP_PRIX_MINIMUM, type OffreType } from "@/lib/validation";

type SavedOptions = { isFirstOffre?: boolean };

type Offre = {
  id: string;
  type: OffreType;
  prix: number | null;
  libelle: string | null;
  actif: boolean;
  config: Record<string, unknown>;
};

// One settings row per offer type (brief v3 point 4): each type is its own
// conversational question with its own field, rather than a repeatable
// "create offer" form with a type dropdown. A créateur only activates the
// ones they're interested in. `video` is the one exception -- see
// VideoOffresList below -- it's a repeatable list, not a single row.
const QUESTIONS: {
  type: Exclude<OffreType, "video">;
  question: string;
  kind: "prix" | "don" | "contenu" | "live";
}[] = [
  {
    type: "whatsapp",
    question: `Si quelqu'un veut ton numéro WhatsApp pour te contacter directement, combien lui factures-tu ? (minimum ${WHATSAPP_PRIX_MINIMUM}$)`,
    kind: "prix",
  },
  {
    type: "shoutout",
    question:
      "Si quelqu'un veut une mention rapide dans une story ou un post, combien lui factures-tu ?",
    kind: "prix",
  },
  {
    type: "don",
    question: "Activer les dons libres (le fan choisit son propre montant)",
    kind: "don",
  },
  {
    type: "contenu_debloque",
    question: "Quel prix pour débloquer ce contenu ?",
    kind: "contenu",
  },
  {
    type: "evenement_live",
    question: "Quel prix pour rejoindre ton prochain live privé ?",
    kind: "live",
  },
];

export function OffresManager({ offres }: { offres: Offre[] }) {
  const router = useRouter();
  const byType = new Map(offres.map((offre) => [offre.type, offre]));
  const videoOffres = offres.filter((offre) => offre.type === "video");
  // "une seule fois" (product brief): naturally self-limiting without a
  // persisted flag -- offres are never deleted in this app, so the API's
  // isFirstOffre can only be true on the very first successful creation,
  // ever, for a given créateur.
  const [showFirstOffreNotice, setShowFirstOffreNotice] = useState(false);

  function handleSaved(opts?: SavedOptions) {
    if (opts?.isFirstOffre) {
      setShowFirstOffreNotice(true);
    }
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-4">
      {showFirstOffreNotice && (
        <div className="card flex items-start gap-3 border-brand-200 bg-brand-50 p-4 dark:border-brand-500/30 dark:bg-brand-500/10">
          <span aria-hidden className="text-xl">
            👀
          </span>
          <div className="flex-1 text-sm">
            <p>
              Ton profil sera visible dans l&apos;exploration publique -- tu
              peux changer ça dans les{" "}
              <Link href="/parametres" className="font-semibold underline">
                réglages
              </Link>
              .
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowFirstOffreNotice(false)}
            aria-label="Fermer"
            className="text-foreground-muted hover:text-foreground"
          >
            ✕
          </button>
        </div>
      )}
      <VideoOffresList videoOffres={videoOffres} onSaved={handleSaved} />
      {QUESTIONS.map((question) => (
        <OffreRow
          key={question.type}
          question={question}
          existing={byType.get(question.type)}
          onSaved={handleSaved}
        />
      ))}
    </section>
  );
}

// Suggestions pré-remplies pour le libellé, mais le champ reste libre --
// un <datalist> propose sans forcer.
const LIBELLE_SUGGESTIONS = ["Anniversaire", "Félicitations", "Danse", "Autre"];

function VideoOffresList({
  videoOffres,
  onSaved,
}: {
  videoOffres: Offre[];
  onSaved: (opts?: SavedOptions) => void;
}) {
  const [draftIds, setDraftIds] = useState<string[]>([]);

  function addDraft() {
    setDraftIds((ids) => [...ids, `draft-${Date.now()}-${ids.length}`]);
  }

  function removeDraft(draftId: string) {
    setDraftIds((ids) => ids.filter((id) => id !== draftId));
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold">
        Si quelqu&apos;un te demande une vidéo personnalisée (anniversaire,
        félicitations, encouragement...), combien lui factures-tu ?
      </p>
      {videoOffres.map((offre) => (
        <VideoOffreRow key={offre.id} existing={offre} onSaved={onSaved} />
      ))}
      {draftIds.map((draftId) => (
        <VideoOffreRow
          key={draftId}
          existing={undefined}
          onSaved={(opts) => {
            removeDraft(draftId);
            onSaved(opts);
          }}
        />
      ))}
      <button
        type="button"
        onClick={addDraft}
        className="self-start text-sm font-semibold text-brand-600 dark:text-brand-300"
      >
        + Ajouter un type de vidéo
      </button>
      <datalist id="video-libelle-suggestions">
        {LIBELLE_SUGGESTIONS.map((suggestion) => (
          <option key={suggestion} value={suggestion} />
        ))}
      </datalist>
    </div>
  );
}

function VideoOffreRow({
  existing,
  onSaved,
}: {
  existing: Offre | undefined;
  onSaved: (opts?: SavedOptions) => void;
}) {
  const [libelle, setLibelle] = useState(existing?.libelle ?? "");
  const [prix, setPrix] = useState(existing?.prix?.toString() ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function submit(nextActif: boolean) {
    setStatus("saving");
    setErrorMessage("");

    try {
      const response = await fetch("/api/offres", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "video",
          prix: Number(prix),
          libelle,
          actif: nextActif,
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof body.error === "string" ? body.error : "enregistrement impossible",
        );
      }

      setStatus("idle");
      onSaved({ isFirstOffre: body.isFirstOffre });
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "erreur inconnue");
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit(true);
      }}
      className="card flex flex-col gap-3 p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          list="video-libelle-suggestions"
          required
          placeholder="Ex : Anniversaire"
          value={libelle}
          onChange={(event) => setLibelle(event.target.value)}
          className={`${inputClass} flex-1 min-w-[10rem]`}
        />
        <input
          type="number"
          min={1}
          step="0.01"
          required
          value={prix}
          onChange={(event) => setPrix(event.target.value)}
          className={`${inputClass} w-24`}
        />
        <span>$</span>

        <button
          type="submit"
          disabled={status === "saving"}
          className={buttonClass("primary", "sm", "ml-auto")}
        >
          {status === "saving" ? "..." : existing ? "Mettre à jour" : "Ajouter"}
        </button>

        {existing && (
          <button
            type="button"
            disabled={status === "saving"}
            onClick={() => submit(!existing.actif)}
            className="text-sm text-foreground-muted hover:text-foreground"
          >
            {existing.actif ? "désactiver" : "réactiver"}
          </button>
        )}
      </div>
      {errorMessage && <p className="text-sm text-danger-600">{errorMessage}</p>}
    </form>
  );
}

function OffreRow({
  question,
  existing,
  onSaved,
}: {
  question: (typeof QUESTIONS)[number];
  existing: Offre | undefined;
  onSaved: (opts?: SavedOptions) => void;
}) {
  const [prix, setPrix] = useState(existing?.prix?.toString() ?? "");
  const [donActif, setDonActif] = useState(existing?.actif ?? false);
  const [lienLive, setLienLive] = useState(
    (existing?.config?.lien_live as string | undefined) ?? "",
  );
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const hasContent = Boolean(existing?.config?.r2_key);

  async function submitOffre(nextActif: boolean) {
    setStatus("saving");
    setErrorMessage("");

    try {
      const payload: Record<string, unknown> = {
        type: question.type,
        actif: nextActif,
      };

      if (question.kind !== "don") {
        payload.prix = Number(prix);
      }

      if (question.kind === "live") {
        payload.config = { lien_live: lienLive };
      }

      const response = await fetch("/api/offres", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof body.error === "string" ? body.error : "enregistrement impossible",
        );
      }

      if (question.kind === "contenu" && file) {
        const offreId = body.offre.id as string;
        const uploadUrlResponse = await fetch(
          `/api/offres/${offreId}/content-upload-url`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contentType: file.type }),
          },
        );
        const uploadUrlBody = await uploadUrlResponse.json();
        if (!uploadUrlResponse.ok) {
          throw new Error(uploadUrlBody.error ?? "upload impossible");
        }

        await fetch(uploadUrlBody.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });

        await fetch(`/api/offres/${offreId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config: { r2_key: uploadUrlBody.r2Key } }),
        });
      }

      setStatus("idle");
      setFile(null);
      onSaved({ isFirstOffre: body.isFirstOffre });
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "erreur inconnue");
    }
  }

  if (question.kind === "don") {
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submitOffre(donActif);
        }}
        className="card flex flex-col gap-3 p-4"
      >
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={donActif}
            onChange={(event) => setDonActif(event.target.checked)}
            className="h-5 w-5 accent-brand-500"
          />
          <span className="text-sm">{question.question}</span>
        </label>
        {errorMessage && <p className="text-sm text-danger-600">{errorMessage}</p>}
        <button
          type="submit"
          disabled={status === "saving"}
          className={buttonClass("primary", "sm", "self-start")}
        >
          {status === "saving" ? "..." : "Enregistrer"}
        </button>
      </form>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submitOffre(true);
      }}
      className="card flex flex-col gap-3 p-4"
    >
      <p className="text-sm">{question.question}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="number"
          min={question.type === "whatsapp" ? WHATSAPP_PRIX_MINIMUM : 1}
          step="0.01"
          required
          value={prix}
          onChange={(event) => setPrix(event.target.value)}
          className={`${inputClass} w-24`}
        />
        <span>$</span>

        {question.kind === "contenu" && (
          <>
            <input
              type="file"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="text-sm text-foreground-muted file:mr-2 file:rounded-full file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-brand-600 dark:file:bg-white/10 dark:file:text-brand-300"
            />
            {hasContent && !file && (
              <span className="text-sm text-foreground-muted">contenu déjà téléversé</span>
            )}
          </>
        )}

        {question.kind === "live" && (
          <input
            type="url"
            required
            placeholder="https://youtube.com/..."
            value={lienLive}
            onChange={(event) => setLienLive(event.target.value)}
            className={`${inputClass} flex-1 min-w-[12rem]`}
          />
        )}

        <button
          type="submit"
          disabled={status === "saving"}
          className={buttonClass("primary", "sm", "ml-auto")}
        >
          {status === "saving" ? "..." : existing ? "Mettre à jour" : "Activer"}
        </button>

        {existing && (
          <button
            type="button"
            disabled={status === "saving"}
            onClick={() => submitOffre(!existing.actif)}
            className="text-sm text-foreground-muted hover:text-foreground"
          >
            {existing.actif ? "désactiver" : "réactiver"}
          </button>
        )}
      </div>
      {errorMessage && <p className="text-sm text-danger-600">{errorMessage}</p>}
    </form>
  );
}
