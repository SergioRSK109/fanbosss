"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { computeCountdownParts, isConcoursEnded } from "@/lib/concours";

// Ticks every second, purely visual -- the server-computed `ended` flag
// on the page itself (and therefore the winner badge) only updates on
// the next navigation/reload; this component just shows the count
// reaching zero and switching to a "terminé" label in the meantime,
// never re-fetches or re-renders the participant list itself.
export function ConcoursCountdown({ dateFin }: { dateFin: string }) {
  const t = useTranslations("Concours");
  const [now, setNow] = useState<Date | null>(null);

  // The initial setState can't run synchronously inside the effect body
  // (react-hooks/set-state-in-effect) -- same setTimeout(fn, 0)
  // workaround already established for ParametresForm's real-time pseudo
  // check and ProduitCheckoutContent's mount-triggered reservation.
  useEffect(() => {
    const timeout = setTimeout(() => setNow(new Date()), 0);
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, []);

  if (now === null) {
    // First paint, before the effect has run -- avoids a hydration
    // mismatch between the server render (no `now` yet) and the client.
    return null;
  }

  if (isConcoursEnded(dateFin, now)) {
    return <p className="text-sm font-semibold text-foreground-muted">{t("termine")}</p>;
  }

  const { days, hours, minutes, seconds } = computeCountdownParts(dateFin, now);
  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    <p className="text-sm font-semibold text-brand-600 dark:text-brand-300">
      {days > 0
        ? t("compteAReboursAvecJours", { jours: days, heures: pad(hours), minutes: pad(minutes), secondes: pad(seconds) })
        : t("compteARebours", { heures: pad(hours), minutes: pad(minutes), secondes: pad(seconds) })}
    </p>
  );
}
