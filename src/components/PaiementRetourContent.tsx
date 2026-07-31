"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Confetti } from "@/components/Confetti";
import { Link } from "@/i18n/navigation";
import { LAST_PAIEMENT_TYPE_STORAGE_KEY } from "@/lib/paiementRetour";
import { OFFRE_TYPES, type OffreType } from "@/lib/validation";

function isOffreType(value: string): value is OffreType {
  return (OFFRE_TYPES as readonly string[]).includes(value);
}

// The confetti burst always plays (this page's entire purpose is a
// payment success return), but the warm message is adapted to the offer
// type only when we actually know it -- see src/lib/paiementRetour.ts for
// why sessionStorage is the mechanism (CinetPay's return_url carries no
// transaction reference back to us). This is inherently fan-only: the
// créateur never lands here with a matching sessionStorage entry, since
// they're never the one who just completed this payment in this browser.
export function PaiementRetourContent() {
  const t = useTranslations("PaiementRetour");
  const [offreType, setOffreType] = useState<OffreType | null>(null);

  useEffect(() => {
    // sessionStorage only exists client-side -- this can't be read during
    // the initial (SSR) render, so a one-time effect-driven read is the
    // correct tool here, not a prop/state mirror the lint rule usually
    // warns about.
    try {
      const stored = sessionStorage.getItem(LAST_PAIEMENT_TYPE_STORAGE_KEY);
      if (stored && isOffreType(stored)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setOffreType(stored);
      }
      sessionStorage.removeItem(LAST_PAIEMENT_TYPE_STORAGE_KEY);
    } catch {
      // sessionStorage unavailable -- generic message below, no crash.
    }
  }, []);

  return (
    <main className="relative mx-auto flex min-h-[70dvh] max-w-sm flex-col items-center justify-center gap-4 px-6 text-center">
      <Confetti />
      <span className="text-5xl">🎉</span>
      <h1 className="text-2xl font-bold">{t("heading")}</h1>
      <p className="text-lg font-medium text-foreground">
        {t(`typeMessages.${offreType ?? "generic"}`)}
      </p>
      <p className="text-foreground-muted">
        {t.rich("message", {
          link: (chunks) => (
            <Link href="/home" className="font-semibold text-brand-600 dark:text-brand-300">
              {chunks}
            </Link>
          ),
        })}
      </p>
    </main>
  );
}
