import { getLocale, getTranslations } from "next-intl/server";
import type { OffreType } from "@/lib/validation";

export interface LitigeEnAttente {
  id: string;
  montant: number;
  offreType: OffreType;
  createdAt: string;
  createurLabel: string;
  fanLabel: string;
}

function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Lot 2a: video/shoutout deliveries a fan flagged via "Signaler un
// problème" (contester_livraison_fan(), migration 0025). Deliberately
// read-only for now, unlike RemboursementsManuelsManager's "Marquer
// comme traité" button -- no resolution mechanism (approve, dismiss,
// manually refund...) was part of this lot's scope, and the underlying
// schema has no flag to clear even if a button were added here. This is
// a visibility worklist only; see CLAUDE.md for why. Oldest first, same
// "longest-overdue surfaces first" principle as the manual-refunds list
// -- ordered by created_at (transaction creation), the only timestamp
// this schema actually has for these rows (contesting doesn't stamp its
// own timestamp, only confirming does via confirme_at).
export async function LitigesManager({ litiges }: { litiges: LitigeEnAttente[] }) {
  const t = await getTranslations("Admin.litiges");
  const tOffers = await getTranslations("CreateurProfile.offerTypes");
  const locale = await getLocale();

  if (litiges.length === 0) {
    return <p className="text-sm text-foreground-muted">{t("empty")}</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {litiges.map((litige) => (
        <li key={litige.id} className="card flex flex-col gap-2 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">
              {tOffers(litige.offreType)} · {litige.montant}$ · {litige.createurLabel} ←{" "}
              {litige.fanLabel}
            </span>
            <span className="shrink-0 text-xs text-foreground-muted">
              {formatDate(litige.createdAt, locale)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
