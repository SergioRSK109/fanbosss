"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { buttonClass } from "@/components/ui/button-styles";

// The parrainage mechanism itself (parrainages table, users.parrain_id,
// the ?ref= signup param, the 10% referral bonus computed in
// handle_transaction_livraison() -- migration 0002) has existed since
// the very first migration. This card is the piece that never existed:
// nowhere in the app ever showed a user their own referral link or what
// they'd earned from it -- see CLAUDE.md's "Parrainage" section for the
// full account of why it stayed invisible. `filleulsActifs`/`totalGagne`
// are computed server-side (ParametresPage) straight from the caller's
// own parrainages rows (parrainages_select_own RLS: parrain_id =
// auth.uid()), never a new RPC -- there's nothing here RLS doesn't
// already scope correctly on its own.
//
// Copy-first, same priority as CopyProfileLinkButton (this card's whole
// point is a quick clipboard copy to paste into a bio/story/DM) -- no
// Web Share fallback here, since a plain referral URL (unlike
// CopyProfileLinkButton's pre-built share sentence) has nothing extra a
// share sheet would add over a raw copy.
export function ParrainageCard({
  userId,
  filleulsActifs,
  totalGagne,
}: {
  userId: string;
  filleulsActifs: number;
  totalGagne: number;
}) {
  const t = useTranslations("Parametres.parrainage");
  const [copied, setCopied] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function handleCopy() {
    setErrorMessage("");
    const url = `${window.location.origin}/signup?ref=${userId}`;
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("clipboard unavailable");
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setErrorMessage(t("copyError"));
    }
  }

  return (
    <section className="card flex flex-col gap-3 px-4 py-4">
      <h2 className="text-sm font-bold text-foreground-muted">{t("heading")}</h2>
      <p className="text-sm text-foreground-muted">{t("description")}</p>

      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={handleCopy}
          className={buttonClass("outline", "sm", "self-start")}
        >
          {copied ? t("copied") : t("copyButton")}
        </button>
        {errorMessage && <p className="text-xs text-danger-600">{errorMessage}</p>}
      </div>

      <div className="mt-1 grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-surface-muted px-3 py-2 text-center">
          <div className="text-lg font-bold">{filleulsActifs}</div>
          <div className="text-xs text-foreground-muted">{t("filleulsActifsLabel")}</div>
        </div>
        <div className="rounded-lg bg-surface-muted px-3 py-2 text-center">
          <div className="text-lg font-bold">{totalGagne.toFixed(2)}$</div>
          <div className="text-xs text-foreground-muted">{t("totalGagneLabel")}</div>
        </div>
      </div>
    </section>
  );
}
