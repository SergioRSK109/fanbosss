"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { WHATSAPP_PRIX_MINIMUM, type OffreType } from "@/lib/validation";

type Offre = {
  id: string;
  type: OffreType;
  prix: number | null;
  actif: boolean;
  config: Record<string, unknown>;
};

// One settings row per offer type (brief v3 point 4): each type is its own
// conversational question with its own field, rather than a repeatable
// "create offer" form with a type dropdown. A créateur only activates the
// ones they're interested in.
const QUESTIONS: {
  type: OffreType;
  question: string;
  kind: "prix" | "don" | "contenu" | "live";
}[] = [
  {
    type: "whatsapp",
    question: `Si quelqu'un veut ton numéro WhatsApp pour te contacter directement, combien lui factures-tu ? (minimum ${WHATSAPP_PRIX_MINIMUM}$)`,
    kind: "prix",
  },
  {
    type: "video",
    question:
      "Si quelqu'un te demande une vidéo personnalisée (anniversaire, félicitations, encouragement...), combien lui factures-tu ?",
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

  return (
    <section className="flex flex-col gap-4">
      {QUESTIONS.map((question) => (
        <OffreRow
          key={question.type}
          question={question}
          existing={byType.get(question.type)}
          onSaved={() => router.refresh()}
        />
      ))}
    </section>
  );
}

function OffreRow({
  question,
  existing,
  onSaved,
}: {
  question: (typeof QUESTIONS)[number];
  existing: Offre | undefined;
  onSaved: () => void;
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
      onSaved();
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
        className="border rounded px-4 py-3 flex flex-col gap-2"
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={donActif}
            onChange={(event) => setDonActif(event.target.checked)}
          />
          <span>{question.question}</span>
        </label>
        {errorMessage && <p className="text-red-600 text-sm">{errorMessage}</p>}
        <button
          type="submit"
          disabled={status === "saving"}
          className="self-start bg-violet-600 text-white rounded px-3 py-1 text-sm disabled:opacity-50"
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
      className="border rounded px-4 py-3 flex flex-col gap-2"
    >
      <p>{question.question}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="number"
          min={question.type === "whatsapp" ? WHATSAPP_PRIX_MINIMUM : 1}
          step="0.01"
          required
          value={prix}
          onChange={(event) => setPrix(event.target.value)}
          className="border rounded px-2 py-1 w-24"
        />
        <span>$</span>

        {question.kind === "contenu" && (
          <>
            <input
              type="file"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="text-sm"
            />
            {hasContent && !file && (
              <span className="text-sm text-gray-500">contenu déjà téléversé</span>
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
            className="border rounded px-2 py-1 flex-1 min-w-[12rem]"
          />
        )}

        <button
          type="submit"
          disabled={status === "saving"}
          className="ml-auto bg-violet-600 text-white rounded px-3 py-1 text-sm disabled:opacity-50"
        >
          {status === "saving" ? "..." : existing ? "Mettre à jour" : "Activer"}
        </button>

        {existing && (
          <button
            type="button"
            disabled={status === "saving"}
            onClick={() => submitOffre(!existing.actif)}
            className="text-sm underline"
          >
            {existing.actif ? "désactiver" : "réactiver"}
          </button>
        )}
      </div>
      {errorMessage && <p className="text-red-600 text-sm">{errorMessage}</p>}
    </form>
  );
}
