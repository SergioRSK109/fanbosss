"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AccountQuickActions, type StatutCompte } from "@/components/admin/AccountQuickActions";
import { buttonClass } from "@/components/ui/button-styles";
import { Link } from "@/i18n/navigation";
import type { PublicationSignalee } from "@/lib/adminPublicationsSignalees";

export type { PublicationSignalee };

function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Lot 5b: publications a fan/créateur flagged (migration 0030), oldest
// first -- same operational-queue principle as every other admin
// worklist. Same client-side pattern as LitigesManager/RetraitsManager
// (per-row pendingId/errorById, router.refresh() on success so a handled
// report disappears via the page's own fresh query, not local state).
// Deliberately no note field, unlike those two -- `reports` has no
// traite_par/traite_at/note_admin columns at all (migration 0030 only
// added `publication_id`, per explicit instruction), so there is nowhere
// for an admin note to be persisted here.
export function PublicationsSignaleesManager({
  signalements,
  statutComptesById,
}: {
  signalements: PublicationSignalee[];
  // Account suspension/ban (migration 0052) -- the reported auteur's
  // CURRENT statut_compte, so AccountQuickActions shows the right button
  // set (a second click on an already-suspended account shouldn't offer
  // "Suspendre" again). Keyed by user id rather than embedded on each
  // PublicationSignalee row so buildPublicationSignalee() (pure,
  // unit-tested) never needed a new parameter for this.
  statutComptesById: Record<string, StatutCompte>;
}) {
  const t = useTranslations("Admin.publicationsSignalees");
  const tCommon = useTranslations("Common");
  const tComptes = useTranslations("Admin.gestionComptes");
  const locale = useLocale();
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [errorById, setErrorById] = useState<Record<string, string>>({});

  async function handleDecision(id: string, decision: "masquer" | "rejeter") {
    setPendingId(id);
    setErrorById((prev) => ({ ...prev, [id]: "" }));

    const response = await fetch("/api/admin/traiter-signalement-publication", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reportId: id, decision }),
    });
    const body = await response.json();

    if (!response.ok) {
      setErrorById((prev) => ({ ...prev, [id]: body.error ?? tCommon("unknownError") }));
      setPendingId(null);
      return;
    }

    setPendingId(null);
    router.refresh();
  }

  if (signalements.length === 0) {
    return <p className="text-sm text-foreground-muted">{t("empty")}</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {signalements.map((signalement) => (
        <li key={signalement.id} className="card flex flex-col gap-2 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">
              {signalement.auteurLabel} · {t("reportedBy", { reporter: signalement.reporterLabel })}
            </span>
            <span className="shrink-0 text-xs text-foreground-muted">
              {formatDate(signalement.createdAt, locale)}
            </span>
          </div>
          {signalement.isRepost && signalement.repostOriginalLabel && (
            <p className="text-xs font-semibold text-foreground-muted">
              {t("repostIndicator", { auteur: signalement.repostOriginalLabel })}
            </p>
          )}
          <p className="whitespace-pre-wrap rounded-2xl bg-surface-muted px-3 py-2 text-sm">
            {signalement.contenu}
          </p>
          {signalement.raison && (
            <p className="text-xs text-foreground-muted">{t("raisonLabel", { raison: signalement.raison })}</p>
          )}
          {/* Links to the REPORTED publication itself -- the repost when
              there is one, never the original -- so the admin sees
              exactly what the reporter saw and flagged, in full context
              (badges, image, embedded original if it's a repost), before
              deciding. No link at all when the reported author never set
              a pseudo: the permalink page 404s on a missing pseudo (see
              [handle]/p/[id]/page.tsx), so there's nothing to link to. */}
          {signalement.pseudo && (
            <Link
              href={`/@${signalement.pseudo}/p/${signalement.id}`}
              target="_blank"
              className="text-xs text-brand-600 underline dark:text-brand-300"
            >
              {t("openPublication")}
            </Link>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pendingId === signalement.id}
              onClick={() => handleDecision(signalement.id, "masquer")}
              className={buttonClass("danger", "sm")}
            >
              {pendingId === signalement.id ? tCommon("saving") : t("masquer")}
            </button>
            <button
              type="button"
              disabled={pendingId === signalement.id}
              onClick={() => handleDecision(signalement.id, "rejeter")}
              className={buttonClass("secondary", "sm")}
            >
              {pendingId === signalement.id ? tCommon("saving") : t("rejeter")}
            </button>
          </div>
          {errorById[signalement.id] && (
            <p className="text-sm text-danger-600">{errorById[signalement.id]}</p>
          )}
          {/* Account suspension/ban (migration 0052) -- quick actions on
              the reported publication's own auteur, so an admin who's
              already looking at this row never has to re-type its
              pseudo into "Gestion des comptes" separately. */}
          <div className="flex flex-col gap-1.5 border-t border-border pt-2">
            <span className="text-xs font-semibold text-foreground-muted">
              {tComptes("quickActionsFor", { label: signalement.auteurLabel })}
            </span>
            <AccountQuickActions
              userId={signalement.auteurId}
              currentStatus={statutComptesById[signalement.auteurId] ?? "actif"}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
