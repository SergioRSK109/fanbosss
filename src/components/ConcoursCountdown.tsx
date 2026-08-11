"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { computeCountdownParts, isConcoursEnded } from "@/lib/concours";

// Ticks every second, purely visual -- the server-computed `ended` flag
// on the page itself (and therefore the winner badge) only updates on
// the next navigation/reload; this component just shows the count
// reaching zero and switching to a "terminé" label in the meantime,
// never re-fetches or re-renders the participant list itself.
//
// `targetDate` is a generic "what this counts down to" -- reused for
// both the concours' own date_fin (variant="fin", the original,
// unchanged behavior) and, since migration 0048, a temps_record deadline
// (variant="tempsRecord"): per the brief, that second countdown should
// simply disappear once its own deadline has passed (no "terminé"
// message of its own -- the concours itself isn't over, only the
// record-time window is), rather than reusing the date_fin variant's
// ended-state wording.
export function ConcoursCountdown({
  targetDate,
  variant = "fin",
}: {
  targetDate: string;
  variant?: "fin" | "tempsRecord";
}) {
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

  const ended = isConcoursEnded(targetDate, now);

  if (ended) {
    if (variant === "tempsRecord") {
      return null;
    }
    return <p className="text-sm font-semibold text-foreground-muted">{t("termine")}</p>;
  }

  const { days, hours, minutes, seconds } = computeCountdownParts(targetDate, now);
  const pad = (n: number) => String(n).padStart(2, "0");
  const key = days > 0 ? "compteAReboursAvecJours" : "compteARebours";
  const values = { jours: days, heures: pad(hours), minutes: pad(minutes), secondes: pad(seconds) };

  if (variant === "tempsRecord") {
    return (
      <p className="text-sm font-semibold text-accent-600 dark:text-accent-300">
        {t("compteATempsRecord", { compte: t(key, values) })}
      </p>
    );
  }

  return (
    <p className="text-sm font-semibold text-brand-600 dark:text-brand-300">{t(key, values)}</p>
  );
}
