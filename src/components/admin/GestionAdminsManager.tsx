"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui/button-styles";

export interface AdminManageableUser {
  id: string;
  email: string | null;
  label: string;
  estAdmin: boolean;
}

export function GestionAdminsManager({ users }: { users: AdminManageableUser[] }) {
  const t = useTranslations("Admin.gestionAdmins");
  const tCommon = useTranslations("Common");
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [errorById, setErrorById] = useState<Record<string, string>>({});

  async function handleToggle(userId: string, nextEstAdmin: boolean) {
    setPendingId(userId);
    setErrorById((prev) => ({ ...prev, [userId]: "" }));

    const response = await fetch("/api/admin/set-admin-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, estAdmin: nextEstAdmin }),
    });
    const body = await response.json();

    if (!response.ok) {
      setErrorById((prev) => ({ ...prev, [userId]: body.error ?? tCommon("unknownError") }));
      setPendingId(null);
      return;
    }

    // Unlike a list that removes its own rows, this user stays in the list
    // after toggling -- router.refresh() re-fetches but doesn't remount this
    // component, so pendingId must be cleared explicitly or the button stays
    // stuck showing its loading state forever.
    setPendingId(null);
    router.refresh();
  }

  return (
    <ul className="flex flex-col gap-2">
      {users.map((u) => (
        <li key={u.id} className="card flex flex-col gap-2 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-sm font-medium">{u.label}</span>
              {u.email && <span className="text-xs text-foreground-muted">{u.email}</span>}
            </div>
            <button
              type="button"
              disabled={pendingId === u.id}
              onClick={() => handleToggle(u.id, !u.estAdmin)}
              className={buttonClass(u.estAdmin ? "danger" : "outline", "sm")}
            >
              {pendingId === u.id
                ? "..."
                : u.estAdmin
                  ? t("revoke")
                  : t("grant")}
            </button>
          </div>
          {errorById[u.id] && <p className="text-sm text-danger-600">{errorById[u.id]}</p>}
        </li>
      ))}
    </ul>
  );
}
