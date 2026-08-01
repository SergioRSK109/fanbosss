"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/ui/button-styles";
import { inputClass, labelClass } from "@/components/ui/field-styles";
import { LAST_PAIEMENT_TYPE_STORAGE_KEY } from "@/lib/paiementRetour";
import {
  RESERVATION_HOLD_SECONDS,
  computeRemainingSeconds,
  formatCountdown,
} from "@/lib/produits";

// Phase 3 of the "produit physique" offer type: the client-side heart of
// the verification page. Auto-triggers reserver_stock_produit() (via
// /api/offres/[id]/reserver-produit) the moment this component mounts --
// there is nothing for a fan to configure before reserving; quantite was
// already chosen on ProduitCard.
//
// Deliberately one component, not a router between several page-level
// components, since the three outcomes (reserved / réservé par un tiers /
// épuisé) share the same "we just tried to reserve, here's what
// happened" framing rather than being genuinely different pages.
type Phase = "reserving" | "reserved" | "unavailable" | "error";
type UnavailableReason = "reserve_tiers" | "epuise";

export function ProduitCheckoutContent({
  offreId,
  libelle,
  prix,
  quantite,
}: {
  offreId: string;
  libelle: string | null;
  prix: number;
  quantite: number;
}) {
  const t = useTranslations("PaiementProduit");
  const locale = useLocale();

  const [phase, setPhase] = useState<Phase>("reserving");
  const [reservationId, setReservationId] = useState<string | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(RESERVATION_HOLD_SECONDS);
  const [unavailableReason, setUnavailableReason] = useState<UnavailableReason | null>(null);
  const [prochaineLiberation, setProchaineLiberation] = useState<string | null>(null);
  const [adresseLivraison, setAdresseLivraison] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState("");

  const expireAtRef = useRef<number | null>(null);

  // Deliberately does NOT reset phase/reservationId/etc. at its own top --
  // every one of those resets would be a setState call synchronous with
  // respect to whichever caller invoked this (the mount effect below, or
  // handleRetry's click handler), which is exactly what
  // react-hooks/set-state-in-effect flags for the *effect* case. Since
  // this function's own state is already at its "fresh" values the
  // moment it's called from the mount effect (phase starts at
  // "reserving" via useState itself), those resets are only ever needed
  // for the retry path -- handleRetry (a plain event handler, not an
  // effect) performs them itself before calling this.
  const attemptReservation = useCallback(async () => {
    try {
      const response = await fetch(`/api/offres/${offreId}/reserver-produit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantite }),
      });
      const body = await response.json();

      if (!response.ok) {
        const reason: UnavailableReason =
          Number(body.disponibleDefinitif) > 0 ? "reserve_tiers" : "epuise";
        setUnavailableReason(reason);
        setProchaineLiberation(body.prochaineLiberation ?? null);
        setPhase("unavailable");
        return;
      }

      const expireAtMs = new Date(body.expireAt).getTime();
      expireAtRef.current = expireAtMs;
      setReservationId(body.reservationId);
      setRemainingSeconds(computeRemainingSeconds(body.expireAt));
      setPhase("reserved");
    } catch {
      setPhase("error");
    }
  }, [offreId, quantite]);

  // Auto-trigger on mount -- there is nothing for the fan to configure
  // first, quantite was already chosen on ProduitCard. Wrapped in a
  // setTimeout (0ms -- no debounce needed here, unlike the pseudo
  // availability check this pattern is borrowed from) so the fetch +
  // its eventual setState calls run from a macrotask callback, not
  // synchronously reachable from the effect body itself -- same
  // react-hooks/set-state-in-effect fix already established in
  // ParametresForm.tsx's own real-time pseudo check.
  useEffect(() => {
    const timeout = setTimeout(() => void attemptReservation(), 0);
    return () => clearTimeout(timeout);
  }, [attemptReservation]);

  function handleRetry() {
    setPhase("reserving");
    setConfirmError("");
    setReservationId(null);
    expireAtRef.current = null;
    void attemptReservation();
  }

  // Countdown, ticking every second while a reservation is held. Hits
  // zero -> "Confirmer le paiement" disables itself and an inline
  // message invites the fan to start over, per the brief -- the reserved
  // card itself stays visible (address text isn't lost), only the action
  // is blocked.
  useEffect(() => {
    if (phase !== "reserved" || expireAtRef.current === null) {
      return;
    }
    const interval = setInterval(() => {
      const remaining = computeRemainingSeconds(expireAtRef.current ?? 0);
      setRemainingSeconds(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [phase, reservationId]);

  async function handleConfirm(event: React.FormEvent) {
    event.preventDefault();
    if (!reservationId || remainingSeconds <= 0 || !adresseLivraison.trim()) {
      return;
    }

    setConfirming(true);
    setConfirmError("");

    try {
      const response = await fetch("/api/transactions/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offreId,
          quantite,
          reservationId,
          adresseLivraison: adresseLivraison.trim(),
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        setConfirmError(body.error ?? t("confirmationImpossible"));
        setConfirming(false);
        return;
      }

      try {
        sessionStorage.setItem(LAST_PAIEMENT_TYPE_STORAGE_KEY, "produit");
      } catch {
        // sessionStorage unavailable -- /paiement/retour just falls back
        // to its generic message, not a reason to block the redirect.
      }

      window.location.href = body.paymentUrl;
    } catch {
      setConfirmError(t("confirmationImpossible"));
      setConfirming(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-[70dvh] max-w-sm flex-col justify-center gap-6 px-5 py-10">
      <div className="text-center">
        <h1 className="text-2xl font-bold">{t("heading")}</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          {t("recapitulatif", { libelle: libelle ?? "", quantite, prix: prix * quantite })}
        </p>
      </div>

      {phase === "reserving" && (
        <p className="text-center text-sm text-foreground-muted">{t("reservationEnCours")}</p>
      )}

      {phase === "error" && (
        <div className="card flex flex-col gap-3 p-5 text-center">
          <p className="text-sm text-danger-600">{t("erreurGenerique")}</p>
          <button type="button" onClick={handleRetry} className={buttonClass("secondary", "sm")}>
            {t("recommencer")}
          </button>
        </div>
      )}

      {phase === "unavailable" && unavailableReason === "reserve_tiers" && (
        <div className="card p-5 text-center text-sm text-foreground-muted">
          {prochaineLiberation
            ? t("reserveAvecEstimation", {
                date: new Date(prochaineLiberation).toLocaleString(locale),
              })
            : t("reserveSansEstimation")}
        </div>
      )}

      {phase === "unavailable" && unavailableReason === "epuise" && (
        <div className="card p-5 text-center">
          <span className="rounded-full bg-foreground-muted/15 px-3 py-1 text-sm font-semibold text-foreground-muted">
            {t("epuise")}
          </span>
        </div>
      )}

      {phase === "reserved" && (
        <form onSubmit={handleConfirm} className="card flex flex-col gap-4 p-5">
          <div className="text-center">
            <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
              {t("tempsRestant")}
            </p>
            <p
              className={`text-3xl font-bold tabular-nums ${
                remainingSeconds <= 0 ? "text-danger-600" : "text-foreground"
              }`}
            >
              {formatCountdown(remainingSeconds)}
            </p>
          </div>

          <label className={labelClass}>
            <span>{t("adresseLabel")}</span>
            <textarea
              required
              rows={3}
              value={adresseLivraison}
              onChange={(event) => setAdresseLivraison(event.target.value)}
              disabled={remainingSeconds <= 0}
              placeholder={t("adressePlaceholder")}
              className={`${inputClass} w-full resize-none`}
            />
          </label>

          {remainingSeconds <= 0 && (
            <div className="flex flex-col gap-2 text-center">
              <p className="text-sm text-danger-600">{t("reservationExpiree")}</p>
              <button
                type="button"
                onClick={handleRetry}
                className={buttonClass("secondary", "sm")}
              >
                {t("recommencer")}
              </button>
            </div>
          )}

          {confirmError && <p className="text-center text-sm text-danger-600">{confirmError}</p>}

          <button
            type="submit"
            disabled={confirming || remainingSeconds <= 0 || !adresseLivraison.trim()}
            className={buttonClass("primary", "lg")}
          >
            {confirming ? t("confirmationEnCours") : t("confirmerPaiement")}
          </button>
        </form>
      )}
    </main>
  );
}
