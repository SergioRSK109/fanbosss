"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { AccountQuickActions, type StatutCompte } from "@/components/admin/AccountQuickActions";
import { inputClass } from "@/components/ui/field-styles";

export interface AccountManageableUser {
  id: string;
  pseudo: string | null;
  label: string;
  statutCompte: StatutCompte;
  statutCompteRaison: string | null;
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
            <AccountQuickActions userId={u.id} currentStatus={u.statutCompte} />
          </li>
        ))}
      </ul>
    </div>
  );
}
