"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass } from "@/components/ui/button-styles";
import { inputClass, labelClass } from "@/components/ui/field-styles";
import { Link } from "@/i18n/navigation";
import type { ConcoursOrganise, InvitationConcours } from "@/lib/concoursPublic";

interface Campagne {
  id: string;
  libelle: string | null;
}

// toLocaleDateString() with no explicit locale resolves from the
// runtime's own default (server) vs the browser's (client) -- a real,
// reproducible hydration mismatch, not just a style nit (caught live
// during Playwright verification: SSR "16/08/2026" vs client
// "8/16/2026"). Every date rendered here must pass the page's own
// active locale explicitly, same as RemboursementsManuelsManager's own
// formatDate().
function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale);
}

const selectClass =
  "rounded-2xl border border-border bg-surface px-4 py-3 text-[0.95rem] text-foreground outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20";

// Phase 1-bis: créateur-facing UI for concours entre créateurs (migration
// 0045/0046) -- schema/RPCs/the public /concours/[id] page already
// existed; this is the first créateur-facing management surface for any
// of it. Three pieces, per the brief: create, respond to invitations
// (own campagne chosen at accept time -- see CLAUDE.md's "Creator
// contests" section for why that moved here instead of staying at invite
// time), and invite someone into a concours you organize (by pseudo,
// resolved server-side -- src/app/api/concours/[id]/inviter/route.ts).
//
// Phase 2 (migration 0047) adds a second mode, maitre_du_jeu, reusing
// this exact tab per the brief's own instruction rather than a new one:
// InvitationRow gained the explicit consent screen (percentage
// breakdown + required checkbox) an invited créateur sees only for a
// maitre_du_jeu invitation, and CreerConcoursMaitreJeuForm is a new,
// separate creation form below the existing entre_createurs one -- it
// has no campagne dependency at all (a Maître du jeu organizer isn't
// necessarily a créateur with a campagne to link), unlike
// CreerConcoursForm.

function CreerConcoursForm({ mesCampagnes }: { mesCampagnes: Campagne[] }) {
  const t = useTranslations("ConcoursManager.creer");
  const tCommon = useTranslations("Common");
  const router = useRouter();
  const [nom, setNom] = useState("");
  const [dateFin, setDateFin] = useState("");
  const [campagneId, setCampagneId] = useState(mesCampagnes[0]?.id ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  if (mesCampagnes.length === 0) {
    return <p className="text-sm text-foreground-muted">{t("aucuneCampagne")}</p>;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("saving");
    setErrorMessage("");

    try {
      const response = await fetch("/api/concours", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nom,
          dateFin: new Date(`${dateFin}T23:59:59`).toISOString(),
          campagneId,
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(typeof body.error === "string" ? body.error : t("echec"));
      }

      setNom("");
      setDateFin("");
      setStatus("idle");
      router.refresh();
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : t("echec"));
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card flex flex-col gap-3 p-4">
      <label className={labelClass}>
        {t("nomLabel")}
        <input
          type="text"
          value={nom}
          onChange={(event) => setNom(event.target.value)}
          required
          maxLength={100}
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        {t("dateFinLabel")}
        <input
          type="date"
          value={dateFin}
          onChange={(event) => setDateFin(event.target.value)}
          required
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        {t("campagneLabel")}
        <select
          value={campagneId}
          onChange={(event) => setCampagneId(event.target.value)}
          className={selectClass}
        >
          {mesCampagnes.map((campagne) => (
            <option key={campagne.id} value={campagne.id}>
              {campagne.libelle ?? campagne.id}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={status === "saving"} className={buttonClass("primary", "sm", "self-start")}>
        {status === "saving" ? tCommon("saving") : t("submit")}
      </button>
      {errorMessage && <p className="text-sm text-danger-600">{errorMessage}</p>}
    </form>
  );
}

// Maître du jeu creation, per the brief: nom / date de fin / pourcentage
// / an optional trophy photo. Two-step submit, same "create the record
// first, then upload, then PATCH the resulting key" flow ProduitRow
// (OffresManager.tsx) already established for offres.image_r2_key --
// R2's presigned-upload pipeline needs a real concours id to build the
// key against, so the photo can only ever be uploaded after creation.
function CreerConcoursMaitreJeuForm() {
  const t = useTranslations("ConcoursManager.creerMaitreJeu");
  const tCommon = useTranslations("Common");
  const router = useRouter();
  const [nom, setNom] = useState("");
  const [dateFin, setDateFin] = useState("");
  const [pourcentage, setPourcentage] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("saving");
    setErrorMessage("");

    try {
      const response = await fetch("/api/concours/maitre-jeu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nom,
          dateFin: new Date(`${dateFin}T23:59:59`).toISOString(),
          pourcentageMaitreJeu: Number(pourcentage),
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(typeof body.error === "string" ? body.error : t("echec"));
      }

      if (file) {
        const concoursId = body.id as string;
        const uploadUrlResponse = await fetch(`/api/concours/${concoursId}/trophee-upload-url`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contentType: file.type, size: file.size }),
        });
        const uploadUrlBody = await uploadUrlResponse.json();
        if (!uploadUrlResponse.ok) {
          throw new Error(uploadUrlBody.error ?? t("uploadImpossible"));
        }

        await fetch(uploadUrlBody.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });

        await fetch(`/api/concours/${concoursId}/trophee`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ r2Key: uploadUrlBody.r2Key }),
        });
      }

      setNom("");
      setDateFin("");
      setPourcentage("");
      setFile(null);
      setStatus("idle");
      router.refresh();
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : t("echec"));
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card flex flex-col gap-3 p-4">
      <label className={labelClass}>
        {t("nomLabel")}
        <input
          type="text"
          value={nom}
          onChange={(event) => setNom(event.target.value)}
          required
          maxLength={100}
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        {t("dateFinLabel")}
        <input
          type="date"
          value={dateFin}
          onChange={(event) => setDateFin(event.target.value)}
          required
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        {t("pourcentageLabel")}
        <input
          type="number"
          min={0}
          max={100}
          step="0.01"
          value={pourcentage}
          onChange={(event) => setPourcentage(event.target.value)}
          required
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        {t("photoLabel")}
        <input
          type="file"
          accept="image/*"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          className={inputClass}
        />
      </label>
      <button type="submit" disabled={status === "saving"} className={buttonClass("primary", "sm", "self-start")}>
        {status === "saving" ? tCommon("saving") : t("submit")}
      </button>
      {errorMessage && <p className="text-sm text-danger-600">{errorMessage}</p>}
    </form>
  );
}

function InviterForm({ concoursId }: { concoursId: string }) {
  const t = useTranslations("ConcoursManager.inviter");
  const tCommon = useTranslations("Common");
  const router = useRouter();
  const [pseudo, setPseudo] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("saving");
    setErrorMessage("");

    try {
      const response = await fetch(`/api/concours/${concoursId}/inviter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pseudo }),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(typeof body.error === "string" ? body.error : t("echec"));
      }

      setPseudo("");
      setStatus("success");
      router.refresh();
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : t("echec"));
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
      <input
        type="text"
        value={pseudo}
        onChange={(event) => {
          setPseudo(event.target.value);
          setStatus("idle");
        }}
        placeholder={t("pseudoPlaceholder")}
        required
        className={`${inputClass} min-w-[10rem] flex-1`}
      />
      <button type="submit" disabled={status === "saving"} className={buttonClass("outline", "sm")}>
        {status === "saving" ? tCommon("saving") : t("submit")}
      </button>
      {status === "success" && <p className="w-full text-sm text-success-600">{t("succes")}</p>}
      {errorMessage && <p className="w-full text-sm text-danger-600">{errorMessage}</p>}
    </form>
  );
}

function ConcoursOrganiseCard({
  concours,
  viewerId,
}: {
  concours: ConcoursOrganise;
  viewerId: string;
}) {
  const t = useTranslations("ConcoursManager.mesConcours");
  const locale = useLocale();

  const sorted = [...concours.participants].sort((a, b) => b.montantCollecte - a.montantCollecte);

  return (
    <li className="card flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <Link href={`/concours/${concours.concoursId}`} className="font-semibold hover:underline">
          {concours.nom}
        </Link>
        <span className="shrink-0 text-xs text-foreground-muted">
          {formatDate(concours.dateFin, locale)}
        </span>
      </div>
      {concours.mode === "maitre_du_jeu" && concours.pourcentageMaitreJeu !== null && (
        <span className="w-fit rounded-full bg-brand-500/15 px-2.5 py-1 text-xs font-semibold text-brand-600 dark:text-brand-300">
          {t("modeMaitreJeuBadge", { pourcentage: concours.pourcentageMaitreJeu })}
        </span>
      )}
      {sorted.length === 0 ? (
        <p className="text-sm text-foreground-muted">{t("aucunParticipant")}</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm text-foreground-muted">
          {sorted.map((p) => (
            <li key={p.createurId} className="flex items-center justify-between gap-2">
              <span>{p.displayName ?? t("createurAnonyme")}</span>
              <span className="font-semibold text-foreground">{p.montantCollecte}$</span>
            </li>
          ))}
        </ul>
      )}
      {concours.organisateurId === viewerId && (
        <div className="border-t border-border pt-3">
          <p className="mb-2 text-sm font-medium">{t("inviterHeading")}</p>
          <InviterForm concoursId={concours.concoursId} />
        </div>
      )}
    </li>
  );
}

function InvitationRow({
  invitation,
  mesCampagnes,
}: {
  invitation: InvitationConcours;
  mesCampagnes: Campagne[];
}) {
  const t = useTranslations("ConcoursManager.invitations");
  const tCommon = useTranslations("Common");
  const locale = useLocale();
  const router = useRouter();
  const [campagneId, setCampagneId] = useState(mesCampagnes[0]?.id ?? "");
  const [conditionsAcceptees, setConditionsAcceptees] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const isMaitreDuJeu = invitation.mode === "maitre_du_jeu";
  const pourcentageOrganisateur = invitation.pourcentageMaitreJeu ?? 0;
  const pourcentageCreateur = 100 - pourcentageOrganisateur;
  const organisateurLabel = invitation.organisateurDisplayName ?? t("createurAnonyme");

  async function handleAccepter() {
    setStatus("saving");
    setErrorMessage("");

    const response = await fetch(`/api/concours/${invitation.concoursId}/accepter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campagneId, conditionsAcceptees }),
    });
    const body = await response.json();

    if (!response.ok) {
      setErrorMessage(typeof body.error === "string" ? body.error : t("echec"));
      setStatus("error");
      return;
    }

    setStatus("idle");
    router.refresh();
  }

  async function handleRefuser() {
    setStatus("saving");
    setErrorMessage("");

    const response = await fetch(`/api/concours/${invitation.concoursId}/refuser`, {
      method: "POST",
    });
    const body = await response.json();

    if (!response.ok) {
      setErrorMessage(typeof body.error === "string" ? body.error : t("echec"));
      setStatus("error");
      return;
    }

    setStatus("idle");
    router.refresh();
  }

  return (
    <li className="card flex flex-col gap-3 p-4">
      <div>
        <p className="font-semibold">{invitation.nom}</p>
        <p className="text-sm text-foreground-muted">
          {t("invitePar", { organisateur: organisateurLabel })}
          {" · "}
          {formatDate(invitation.dateFin, locale)}
        </p>
      </div>
      {mesCampagnes.length === 0 ? (
        <p className="text-sm text-foreground-muted">{t("aucuneCampagne")}</p>
      ) : (
        <label className={labelClass}>
          {t("campagneLabel")}
          <select
            value={campagneId}
            onChange={(event) => setCampagneId(event.target.value)}
            className={selectClass}
          >
            {mesCampagnes.map((campagne) => (
              <option key={campagne.id} value={campagne.id}>
                {campagne.libelle ?? campagne.id}
              </option>
            ))}
          </select>
        </label>
      )}
      {isMaitreDuJeu && (
        <div className="rounded-2xl border border-border bg-surface-muted p-3">
          <p className="text-sm font-medium">
            {t("consentement.repartition", {
              pourcentageCreateur,
              pourcentageOrganisateur,
              organisateur: organisateurLabel,
            })}
          </p>
          <label className="mt-2 flex items-start gap-2 text-sm text-foreground-muted">
            <input
              type="checkbox"
              checked={conditionsAcceptees}
              onChange={(event) => setConditionsAcceptees(event.target.checked)}
              className="mt-0.5"
            />
            <span>
              {t("consentement.checkbox", {
                pourcentage: pourcentageOrganisateur,
                organisateur: organisateurLabel,
              })}
            </span>
          </label>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleAccepter}
          disabled={
            status === "saving" || mesCampagnes.length === 0 || (isMaitreDuJeu && !conditionsAcceptees)
          }
          className={buttonClass("primary", "sm")}
        >
          {status === "saving" ? tCommon("saving") : t("accepter")}
        </button>
        <button
          type="button"
          onClick={handleRefuser}
          disabled={status === "saving"}
          className={buttonClass("outline", "sm")}
        >
          {t("refuser")}
        </button>
      </div>
      {errorMessage && <p className="text-sm text-danger-600">{errorMessage}</p>}
    </li>
  );
}

export function ConcoursManager({
  viewerId,
  mesConcours,
  invitations,
  mesCampagnes,
}: {
  viewerId: string;
  mesConcours: ConcoursOrganise[];
  invitations: InvitationConcours[];
  mesCampagnes: Campagne[];
}) {
  const t = useTranslations("ConcoursManager");

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h3 className="mb-3 text-base font-bold">{t("mesConcours.heading")}</h3>
        {mesConcours.length === 0 ? (
          <p className="text-sm text-foreground-muted">{t("mesConcours.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {mesConcours.map((concours) => (
              <ConcoursOrganiseCard key={concours.concoursId} concours={concours} viewerId={viewerId} />
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-3 text-base font-bold">{t("invitations.heading")}</h3>
        {invitations.length === 0 ? (
          <p className="text-sm text-foreground-muted">{t("invitations.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {invitations.map((invitation) => (
              <InvitationRow
                key={invitation.concoursId}
                invitation={invitation}
                mesCampagnes={mesCampagnes}
              />
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-3 text-base font-bold">{t("creer.heading")}</h3>
        <CreerConcoursForm mesCampagnes={mesCampagnes} />
      </section>

      <section>
        <h3 className="mb-3 text-base font-bold">{t("creerMaitreJeu.heading")}</h3>
        <CreerConcoursMaitreJeuForm />
      </section>
    </div>
  );
}
