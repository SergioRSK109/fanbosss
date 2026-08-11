"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Link } from "@/i18n/navigation";
import { buttonClass } from "@/components/ui/button-styles";
import { inputClass, labelClass } from "@/components/ui/field-styles";
import {
  computeCampagneProgressPercent,
  computeCampagneStatus,
  formatMontant,
  type CampagneStatus,
} from "@/lib/campagnes";
import { calculerRepartitionPaiement } from "@/lib/transactions";
import { WHATSAPP_PRIX_MINIMUM, type OffreType } from "@/lib/validation";

type SavedOptions = { isFirstOffre?: boolean };

type Offre = {
  id: string;
  type: OffreType;
  prix: number | null;
  libelle: string | null;
  actif: boolean;
  config: Record<string, unknown>;
  // Only meaningful for `campagne` rows -- computed live server-side from
  // campagnes_montant_collecte (migration 0017), never stored on the row
  // itself. Optional because non-campagne offres never carry it.
  montantCollecte?: number;
  // Phase 2 of the produit physique offer type -- only meaningful for
  // `produit` rows (migration 0039/0040).
  stock_total?: number | null;
  image_r2_key?: string | null;
};

// One settings row per offer type (brief v3 point 4): each type is its own
// conversational question with its own field, rather than a repeatable
// "create offer" form with a type dropdown. A créateur only activates the
// ones they're interested in. `video` is the one exception -- see
// VideoOffresList below -- it's a repeatable list, not a single row. The
// question copy itself is resolved via `t("questions.<type>")` inside the
// component (translated) -- this array only holds the type/kind pairing,
// since the copy needs a live translator, not a module-load-time literal.
const QUESTION_TYPES: {
  type: Exclude<OffreType, "video">;
  kind: "prix" | "don" | "contenu" | "live";
}[] = [
  { type: "whatsapp", kind: "prix" },
  { type: "shoutout", kind: "prix" },
  { type: "don", kind: "don" },
  { type: "contenu_debloque", kind: "contenu" },
  { type: "evenement_live", kind: "live" },
];

// Phase 2 of the produit physique offer type: `/offres`'s Service tab
// renders this in `mode="service"` (its original, unmodified behavior --
// video/campagne/QUESTION_TYPES already never included `produit`, so
// nothing here needed to change for that mode), and the new Produit
// physique tab renders it in `mode="produit"` instead, which shows only
// ProduitsList. One component, two mutually exclusive render branches --
// not two separate components -- since both share the same
// SavedOptions/first-offre-notice plumbing.
export function OffresManager({ offres, mode = "service" }: { offres: Offre[]; mode?: "service" | "produit" }) {
  const t = useTranslations("OffresManager");
  const tCommon = useTranslations("Common");
  const router = useRouter();
  const byType = new Map(offres.map((offre) => [offre.type, offre]));
  const videoOffres = offres.filter((offre) => offre.type === "video");
  const campagneOffres = offres.filter((offre) => offre.type === "campagne");
  const produitOffres = offres.filter((offre) => offre.type === "produit");
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

  if (mode === "produit") {
    return (
      <section className="flex flex-col gap-4">
        {showFirstOffreNotice && (
          <div className="card flex items-start gap-3 border-brand-200 bg-brand-50 p-4 dark:border-brand-500/30 dark:bg-brand-500/10">
            <span aria-hidden className="text-xl">
              👀
            </span>
            <div className="flex-1 text-sm">
              <p>
                {t.rich("firstOffreNotice", {
                  link: (chunks) => (
                    <Link href="/parametres" className="font-semibold underline">
                      {chunks}
                    </Link>
                  ),
                })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowFirstOffreNotice(false)}
              aria-label={tCommon("close")}
              className="text-foreground-muted hover:text-foreground"
            >
              ✕
            </button>
          </div>
        )}
        <ProduitsList produitOffres={produitOffres} onSaved={handleSaved} />
      </section>
    );
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
              {t.rich("firstOffreNotice", {
                link: (chunks) => (
                  <Link href="/parametres" className="font-semibold underline">
                    {chunks}
                  </Link>
                ),
              })}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowFirstOffreNotice(false)}
            aria-label={tCommon("close")}
            className="text-foreground-muted hover:text-foreground"
          >
            ✕
          </button>
        </div>
      )}
      <VideoOffresList videoOffres={videoOffres} onSaved={handleSaved} />
      <CampagnesList campagneOffres={campagneOffres} onSaved={handleSaved} />
      {QUESTION_TYPES.map((question) => (
        <OffreRow
          key={question.type}
          question={{
            ...question,
            question:
              question.type === "whatsapp"
                ? t("questions.whatsapp", { minimum: WHATSAPP_PRIX_MINIMUM })
                : t(`questions.${question.type}`),
          }}
          existing={byType.get(question.type)}
          onSaved={handleSaved}
        />
      ))}
    </section>
  );
}

function VideoOffresList({
  videoOffres,
  onSaved,
}: {
  videoOffres: Offre[];
  onSaved: (opts?: SavedOptions) => void;
}) {
  const t = useTranslations("OffresManager");
  // Suggestions pré-remplies pour le libellé, mais le champ reste libre --
  // un <datalist> propose sans forcer. Pulled straight from the message
  // catalog (t.raw) rather than a hardcoded array, so the suggestions
  // shown are in the visitor's own language.
  const libelleSuggestions = t.raw("libelleSuggestions") as string[];
  const [draftIds, setDraftIds] = useState<string[]>([]);

  function addDraft() {
    setDraftIds((ids) => [...ids, `draft-${Date.now()}-${ids.length}`]);
  }

  function removeDraft(draftId: string) {
    setDraftIds((ids) => ids.filter((id) => id !== draftId));
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold">{t("videoQuestion")}</p>
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
        {t("addVideoType")}
      </button>
      <datalist id="video-libelle-suggestions">
        {libelleSuggestions.map((suggestion) => (
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
  const t = useTranslations("OffresManager");
  const tCommon = useTranslations("Common");
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
          typeof body.error === "string" ? body.error : tCommon("saveError"),
        );
      }

      setStatus("idle");
      onSaved({ isFirstOffre: body.isFirstOffre });
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : tCommon("unknownError"));
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
          placeholder={t("libellePlaceholder")}
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
          {status === "saving" ? "..." : existing ? tCommon("update") : tCommon("add")}
        </button>

        {existing && (
          <button
            type="button"
            disabled={status === "saving"}
            onClick={() => submit(!existing.actif)}
            className="text-sm text-foreground-muted hover:text-foreground"
          >
            {existing.actif ? tCommon("deactivate") : tCommon("reactivate")}
          </button>
        )}
      </div>
      {errorMessage && <p className="text-sm text-danger-600">{errorMessage}</p>}
    </form>
  );
}

const CAMPAGNE_STATUS_STYLES: Record<CampagneStatus, string> = {
  active: "bg-brand-500/15 text-brand-600 dark:text-brand-300",
  objectif_atteint: "bg-success-500/15 text-success-600",
  terminee: "bg-foreground-muted/15 text-foreground-muted",
};

// Repeatable, multi-row type (a créateur can run several campaigns over
// time, each with its own libelle-as-title) -- same pattern as
// VideoOffresList above, not a single settings row like QUESTIONS.
function CampagnesList({
  campagneOffres,
  onSaved,
}: {
  campagneOffres: Offre[];
  onSaved: (opts?: SavedOptions) => void;
}) {
  const t = useTranslations("OffresManager");
  const [draftIds, setDraftIds] = useState<string[]>([]);

  function addDraft() {
    setDraftIds((ids) => [...ids, `draft-${Date.now()}-${ids.length}`]);
  }

  function removeDraft(draftId: string) {
    setDraftIds((ids) => ids.filter((id) => id !== draftId));
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold">{t("campagnesIntro")}</p>
      {campagneOffres.map((offre) => (
        <CampagneRow key={offre.id} existing={offre} onSaved={onSaved} />
      ))}
      {draftIds.map((draftId) => (
        <CampagneRow
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
        {t("addCampagne")}
      </button>
    </div>
  );
}

function CampagneRow({
  existing,
  onSaved,
}: {
  existing: Offre | undefined;
  onSaved: (opts?: SavedOptions) => void;
}) {
  const t = useTranslations("OffresManager");
  const tCommon = useTranslations("Common");
  const tCreateurProfile = useTranslations("CreateurProfile");
  const locale = useLocale();
  const existingConfig = (existing?.config ?? {}) as {
    description?: string;
    objectif?: number;
    date_fin?: string | null;
  };
  const [titre, setTitre] = useState(existing?.libelle ?? "");
  const [description, setDescription] = useState(existingConfig.description ?? "");
  const [objectif, setObjectif] = useState(existingConfig.objectif?.toString() ?? "");
  const [dateFin, setDateFin] = useState(existingConfig.date_fin ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const objectifNumber = Number(objectif);
  // Live calculator: reuses calculerRepartitionPaiement (src/lib/transactions.ts),
  // the exact same commission/frais/TVA formula create_paiement_on_validation()
  // applies in the database -- never a second, independently-maintained
  // calculation that could drift from the real one if the rates change.
  const repartition =
    objectifNumber > 0 ? calculerRepartitionPaiement(objectifNumber) : null;

  const campagneStatus = existing
    ? computeCampagneStatus({
        actif: existing.actif,
        montantCollecte: existing.montantCollecte ?? 0,
        objectif: Number(existingConfig.objectif) || 0,
        dateFin: existingConfig.date_fin ?? null,
      })
    : null;

  async function submit(nextActif: boolean) {
    setStatus("saving");
    setErrorMessage("");

    try {
      const response = await fetch("/api/offres", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "campagne",
          libelle: titre,
          actif: nextActif,
          config: {
            description,
            objectif: objectifNumber,
            date_fin: dateFin || null,
          },
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof body.error === "string" ? body.error : tCommon("saveError"),
        );
      }

      setStatus("idle");
      onSaved({ isFirstOffre: body.isFirstOffre });
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : tCommon("unknownError"));
    }
  }

  const campagneStatusLabel = campagneStatus
    ? campagneStatus === "active"
      ? t("campagneStatusActive")
      : campagneStatus === "objectif_atteint"
        ? tCreateurProfile("campagnes.badgeObjectifAtteint")
        : tCreateurProfile("campagnes.badgeTerminee")
    : null;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit(true);
      }}
      className="card flex flex-col gap-3 p-4"
    >
      {existing && campagneStatus && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">{existing.libelle}</span>
            <div className="flex items-center gap-2">
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${CAMPAGNE_STATUS_STYLES[campagneStatus]}`}
              >
                {campagneStatusLabel}
              </span>
              <span className="text-xs text-foreground-muted">
                {t("campagneMontantSlash", {
                  collecte: formatMontant(existing.montantCollecte ?? 0, locale),
                  objectif: formatMontant(Number(existingConfig.objectif) || 0, locale),
                })}
              </span>
            </div>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
            <div
              className="h-full rounded-full bg-brand-500"
              style={{
                width: `${computeCampagneProgressPercent(existing.montantCollecte ?? 0, Number(existingConfig.objectif) || 0)}%`,
              }}
            />
          </div>
        </div>
      )}

      <label className={labelClass}>
        <span>{t("titreLabel")}</span>
        <input
          type="text"
          required
          placeholder={t("titrePlaceholder")}
          value={titre}
          onChange={(event) => setTitre(event.target.value)}
          className={`${inputClass} w-full`}
        />
      </label>

      <label className={labelClass}>
        <span>{t("descriptionLabel")}</span>
        <textarea
          required
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className={`${inputClass} w-full resize-none`}
        />
      </label>

      <label className={labelClass}>
        <span>{t("objectifLabel")}</span>
        <input
          type="number"
          min={1}
          step="0.01"
          required
          value={objectif}
          onChange={(event) => setObjectif(event.target.value)}
          className={`${inputClass} w-32`}
        />
      </label>

      {repartition && (
        <p className="text-xs text-foreground-muted">
          {t.rich("liveCalculatorText", {
            montant: formatMontant(repartition.montantNetCreateur, locale),
            b: (chunks) => <span className="font-semibold text-foreground">{chunks}</span>,
          })}
        </p>
      )}

      <label className={labelClass}>
        <span>{t("dateFinLabel")}</span>
        <input
          type="date"
          value={dateFin ?? ""}
          onChange={(event) => setDateFin(event.target.value)}
          className={`${inputClass} w-full`}
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={status === "saving"}
          className={buttonClass("primary", "sm", "ml-auto")}
        >
          {status === "saving" ? "..." : existing ? tCommon("update") : t("campagneLaunch")}
        </button>

        {existing && (
          <button
            type="button"
            disabled={status === "saving"}
            onClick={() => submit(!existing.actif)}
            className="text-sm text-foreground-muted hover:text-foreground"
          >
            {existing.actif ? tCommon("deactivate") : tCommon("reactivate")}
          </button>
        )}
      </div>
      {errorMessage && <p className="text-sm text-danger-600">{errorMessage}</p>}
    </form>
  );
}

// Phase 2 of the produit physique offer type -- repeatable, multi-row,
// same "several distinct rows, distinguished by libelle" pattern as
// VideoOffresList/CampagnesList above (a créateur can list several
// different physical products, each with its own price/stock/image).
function ProduitsList({
  produitOffres,
  onSaved,
}: {
  produitOffres: Offre[];
  onSaved: (opts?: SavedOptions) => void;
}) {
  const t = useTranslations("OffresManager");
  const [draftIds, setDraftIds] = useState<string[]>([]);

  function addDraft() {
    setDraftIds((ids) => [...ids, `draft-${Date.now()}-${ids.length}`]);
  }

  function removeDraft(draftId: string) {
    setDraftIds((ids) => ids.filter((id) => id !== draftId));
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold">{t("produitsIntro")}</p>
      {produitOffres.map((offre) => (
        <ProduitRow key={offre.id} existing={offre} onSaved={onSaved} />
      ))}
      {draftIds.map((draftId) => (
        <ProduitRow
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
        {t("addProduit")}
      </button>
    </div>
  );
}

function ProduitRow({
  existing,
  onSaved,
}: {
  existing: Offre | undefined;
  onSaved: (opts?: SavedOptions) => void;
}) {
  const t = useTranslations("OffresManager");
  const tCommon = useTranslations("Common");
  const [libelle, setLibelle] = useState(existing?.libelle ?? "");
  const [prix, setPrix] = useState(existing?.prix?.toString() ?? "");
  const [stockTotal, setStockTotal] = useState(existing?.stock_total?.toString() ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const hasImage = Boolean(existing?.image_r2_key);

  async function submit(nextActif: boolean) {
    setStatus("saving");
    setErrorMessage("");

    try {
      const response = await fetch("/api/offres", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "produit",
          libelle,
          prix: Number(prix),
          stock_total: Number(stockTotal),
          actif: nextActif,
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof body.error === "string" ? body.error : tCommon("saveError"),
        );
      }

      // Same "create the offre first, then upload, then PATCH the
      // resulting key" flow as contenu_debloque's own r2_key (OffreRow
      // below), except image_r2_key is a real top-level column
      // (migration 0039), not a config key.
      if (file) {
        const offreId = body.offre.id as string;
        const uploadUrlResponse = await fetch(
          `/api/offres/${offreId}/image-upload-url`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contentType: file.type, size: file.size }),
          },
        );
        const uploadUrlBody = await uploadUrlResponse.json();
        if (!uploadUrlResponse.ok) {
          throw new Error(uploadUrlBody.error ?? t("uploadImpossible"));
        }

        await fetch(uploadUrlBody.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });

        await fetch(`/api/offres/${offreId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image_r2_key: uploadUrlBody.r2Key }),
        });
      }

      setStatus("idle");
      setFile(null);
      onSaved({ isFirstOffre: body.isFirstOffre });
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : tCommon("unknownError"));
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
      <label className={labelClass}>
        <span>{t("produitLibelleLabel")}</span>
        <input
          type="text"
          required
          placeholder={t("produitLibellePlaceholder")}
          value={libelle}
          onChange={(event) => setLibelle(event.target.value)}
          className={`${inputClass} w-full`}
        />
      </label>

      <div className="flex flex-wrap items-center gap-4">
        <label className={labelClass}>
          <span>{t("prixUnitaireLabel")}</span>
          <div className="flex items-center gap-2">
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
          </div>
        </label>

        <label className={labelClass}>
          <span>{t("stockLabel")}</span>
          <input
            type="number"
            min={1}
            step="1"
            required
            value={stockTotal}
            onChange={(event) => setStockTotal(event.target.value)}
            className={`${inputClass} w-24`}
          />
        </label>
      </div>

      <label className={labelClass}>
        <span>{t("imageLabel")}</span>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="file"
            accept="image/*"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="text-sm text-foreground-muted file:mr-2 file:rounded-full file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-brand-600 dark:file:bg-white/10 dark:file:text-brand-300"
          />
          {hasImage && !file && (
            <span className="text-sm text-foreground-muted">{t("imageDejaTeleversee")}</span>
          )}
        </div>
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={status === "saving"}
          className={buttonClass("primary", "sm", "ml-auto")}
        >
          {status === "saving" ? "..." : existing ? tCommon("update") : t("produitLaunch")}
        </button>

        {existing && (
          <button
            type="button"
            disabled={status === "saving"}
            onClick={() => submit(!existing.actif)}
            className="text-sm text-foreground-muted hover:text-foreground"
          >
            {existing.actif ? tCommon("deactivate") : tCommon("reactivate")}
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
  question: (typeof QUESTION_TYPES)[number] & { question: string };
  existing: Offre | undefined;
  onSaved: (opts?: SavedOptions) => void;
}) {
  const t = useTranslations("OffresManager");
  const tCommon = useTranslations("Common");
  const [prix, setPrix] = useState(existing?.prix?.toString() ?? "");
  const [donActif, setDonActif] = useState(existing?.actif ?? false);
  const [lienLive, setLienLive] = useState(
    (existing?.config?.lien_live as string | undefined) ?? "",
  );
  const [dureeAccesJours, setDureeAccesJours] = useState(
    (existing?.config?.duree_acces_jours as number | undefined)?.toString() ?? "",
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

      // contenu_debloque's config carries two keys set by two different
      // flows -- r2_key (below, only once a file is actually uploaded)
      // and duree_acces_jours (this save). Both this POST's config and
      // the follow-up upload PATCH replace the whole config column
      // wholesale (never a partial JSONB merge -- see /api/offres's own
      // comment on why config is only ever sent when explicitly meant),
      // so this save has to carry the existing r2_key forward itself or
      // a plain price/duration edit would silently wipe out an already-
      // uploaded file's reference.
      let contenuConfig: Record<string, unknown> | undefined;
      if (question.kind === "contenu") {
        contenuConfig = { ...(existing?.config ?? {}) };
        if (dureeAccesJours.trim()) {
          contenuConfig.duree_acces_jours = Number(dureeAccesJours);
        } else {
          delete contenuConfig.duree_acces_jours;
        }
        payload.config = contenuConfig;
      }

      const response = await fetch("/api/offres", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof body.error === "string" ? body.error : tCommon("saveError"),
        );
      }

      if (question.kind === "contenu" && file) {
        const offreId = body.offre.id as string;
        const uploadUrlResponse = await fetch(
          `/api/offres/${offreId}/content-upload-url`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contentType: file.type, size: file.size }),
          },
        );
        const uploadUrlBody = await uploadUrlResponse.json();
        if (!uploadUrlResponse.ok) {
          throw new Error(uploadUrlBody.error ?? t("uploadImpossible"));
        }

        await fetch(uploadUrlBody.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });

        await fetch(`/api/offres/${offreId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          // Carries duree_acces_jours forward from the same submit --
          // this PATCH also replaces config wholesale (see the comment
          // above), so omitting it here would silently wipe out a
          // duration set in the very same save.
          body: JSON.stringify({ config: { ...contenuConfig, r2_key: uploadUrlBody.r2Key } }),
        });
      }

      setStatus("idle");
      setFile(null);
      onSaved({ isFirstOffre: body.isFirstOffre });
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : tCommon("unknownError"));
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
          {status === "saving" ? tCommon("saving") : tCommon("save")}
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
              <span className="text-sm text-foreground-muted">
                {t("contenuDejaTeleverse")}
              </span>
            )}
            <div className="flex items-center gap-2">
              <label className={labelClass}>{t("dureeAccesLabel")}</label>
              <input
                type="number"
                min={1}
                step="1"
                placeholder="30"
                value={dureeAccesJours}
                onChange={(event) => setDureeAccesJours(event.target.value)}
                className={`${inputClass} w-20`}
              />
              <span className="text-xs text-foreground-muted">{t("dureeAccesJoursSuffix")}</span>
            </div>
          </>
        )}

        {question.kind === "live" && (
          <input
            type="url"
            required
            placeholder={t("liveUrlPlaceholder")}
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
          {status === "saving" ? "..." : existing ? tCommon("update") : tCommon("activate")}
        </button>

        {existing && (
          <button
            type="button"
            disabled={status === "saving"}
            onClick={() => submitOffre(!existing.actif)}
            className="text-sm text-foreground-muted hover:text-foreground"
          >
            {existing.actif ? tCommon("deactivate") : tCommon("reactivate")}
          </button>
        )}
      </div>
      {errorMessage && <p className="text-sm text-danger-600">{errorMessage}</p>}
    </form>
  );
}
