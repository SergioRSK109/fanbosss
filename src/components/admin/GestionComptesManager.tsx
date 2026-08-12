"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { AccountQuickActions, type StatutCompte } from "@/components/admin/AccountQuickActions";
import { inputClass } from "@/components/ui/field-styles";

function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export interface AvertissementHistoryRow {
  id: string;
  raison: string;
  emisAt: string;
  vuAt: string | null;
}

export interface AccountManageableUser {
  id: string;
  pseudo: string | null;
  label: string;
  statutCompte: StatutCompte;
  statutCompteRaison: string | null;
  // Admin warning mechanism (migration 0053) -- every avertissement ever
  // issued to this account, most recent first (already sorted that way
  // by the admin page's own query, same "oldest-worklist-item-first vs.
  // newest-history-item-first" split every other admin history list in
  // this project already makes). Empty, never undefined, for an account
  // with no warnings -- so this section can just check .length rather
  // than distinguishing "no data fetched" from "genuinely none".
  avertissements: AvertissementHistoryRow[];
}

const STATUT_BADGE_CLASS: Record<StatutCompte, string> = {
  actif: "bg-foreground-muted/15 text-foreground-muted",
  suspendu: "bg-accent-500/15 text-accent-600",
  banni: "bg-danger-500/15 text-danger-600",
};

// Account suspension/ban (migration 0052) -- "Gestion des comptes",
// search by pseudo (or display name), then Suspendre/Bannir/Réactiver.
// Client-side substring filter over the same full user list
// GestionAdminsManager already receives as props (no new search route --
// this project's own scale doesn't warrant one, same reasoning that
// already applies to that sibling tool) -- results only render once at
// least 2 characters are typed, so this reads as a search tool, not a
// second "browse every account" list sitting next to it.
export function GestionComptesManager({ users }: { users: AccountManageableUser[] }) {
  const t = useTranslations("Admin.gestionComptes");
  const locale = useLocale();
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) {
      return [];
    }
    return users
      .filter(
        (u) =>
          (u.pseudo && u.pseudo.toLowerCase().includes(needle)) ||
          u.label.toLowerCase().includes(needle),
      )
      .slice(0, 20);
  }, [users, query]);

  return (
    <div className="flex flex-col gap-3">
      <input
        type="text"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("searchPlaceholder")}
        className={`${inputClass} w-full`}
      />
      {query.trim().length >= 2 && results.length === 0 && (
        <p className="text-sm text-foreground-muted">{t("searchEmpty")}</p>
      )}
      <ul className="flex flex-col gap-2">
        {results.map((u) => (
          <li key={u.id} className="card flex flex-col gap-2 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">
                {u.label}
                {u.pseudo && <span className="text-foreground-muted"> · @{u.pseudo}</span>}
              </span>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUT_BADGE_CLASS[u.statutCompte]}`}
              >
                {t(`statut.${u.statutCompte}`)}
              </span>
            </div>
            {u.statutCompteRaison && (
              <p className="text-xs text-foreground-muted">
                {t("raisonLabel", { raison: u.statutCompteRaison })}
              </p>
            )}
            {u.avertissements.length > 0 && (
              <div className="rounded-2xl bg-surface-muted px-3 py-2">
                <p className="text-xs font-semibold text-foreground-muted">
                  {t("avertissementsHeading", { count: u.avertissements.length })}
                </p>
                <ul className="mt-1 flex flex-col gap-1">
                  {u.avertissements.map((a) => (
                    <li key={a.id} className="text-xs text-foreground-muted">
                      {formatDate(a.emisAt, locale)} — {a.raison} (
                      {a.vuAt ? t("avertissementVu") : t("avertissementNonVu")})
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <AccountQuickActions userId={u.id} currentStatus={u.statutCompte} />
          </li>
        ))}
      </ul>
    </div>
  );
}
