"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Link } from "@/i18n/navigation";
import { buttonClass } from "@/components/ui/button-styles";
import { buildQuantiteOptions, computeDisponibiliteEtat } from "@/lib/produits";

type Produit = {
  id: string;
  libelle: string | null;
  prix: number;
  imageUrl: string | null;
  disponibleMaintenant: number;
  disponibleDefinitif: number;
  prochaineLiberation: string | null;
};

// Phase 3 of the "produit physique" offer type. Availability is always
// read straight from offres_disponibilite_produit (via profil.ts) --
// never re-derived here -- so this card can never disagree with what
// reserver_stock_produit() itself will actually enforce a moment later.
// Three states, per the brief, deliberately mutually exclusive:
//  - en stock (disponibleMaintenant > 0): a quantity selector bounded to
//    the real disponibleMaintenant, "Commander" -- not "Payer" directly,
//    since the next step is a reservation, not a payment yet.
//  - réservé temporairement (disponibleMaintenant insuffisant but
//    disponibleDefinitif > 0): someone else's active hold; a message
//    with the prochaine_liberation estimate, no actionable button at all.
//  - épuisé (disponibleDefinitif = 0): gone for real, no countdown, no
//    button.
export function ProduitCard({ produit }: { produit: Produit }) {
  const t = useTranslations("CreateurProfile.produits");
  const locale = useLocale();
  const [quantite, setQuantite] = useState(1);

  const state = computeDisponibiliteEtat(
    produit.disponibleMaintenant,
    produit.disponibleDefinitif,
  );

  return (
    <li className="card flex flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        {produit.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a signed R2 URL, not a static asset next/image can optimize.
          <img
            src={produit.imageUrl}
            alt=""
            className="h-16 w-16 shrink-0 rounded-2xl object-cover"
          />
        ) : (
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-2xl dark:bg-white/10">
            📦
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.95rem] font-semibold leading-snug">
            {produit.libelle}
          </p>
          <p className="font-bold text-brand-600 dark:text-brand-300">{produit.prix}$</p>
        </div>
      </div>

      {state === "en_stock" && (
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-foreground-muted">{t("quantiteLabel")}</span>
            <select
              value={quantite}
              onChange={(event) => setQuantite(Number(event.target.value))}
              className="rounded-xl border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-brand-500"
            >
              {buildQuantiteOptions(produit.disponibleMaintenant).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <Link
            href={`/paiement/produit/${produit.id}?quantite=${quantite}`}
            className={buttonClass("primary", "sm")}
          >
            {t("commander")}
          </Link>
        </div>
      )}

      {state === "reserve" && (
        <p className="text-sm text-foreground-muted">
          {produit.prochaineLiberation
            ? t("reserveAvecEstimation", {
                date: new Date(produit.prochaineLiberation).toLocaleString(locale),
              })
            : t("reserveSansEstimation")}
        </p>
      )}

      {state === "epuise" && (
        <span className="self-start rounded-full bg-foreground-muted/15 px-3 py-1 text-sm font-semibold text-foreground-muted">
          {t("epuise")}
        </span>
      )}
    </li>
  );
}
