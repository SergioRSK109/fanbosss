import { useLocale, useTranslations } from "next-intl";
import { CheckoutButton } from "@/components/CheckoutButton";
import { ProfileTabs } from "@/components/ProfileTabs";
import { PublicationsList } from "@/components/PublicationsList";
import { ReportButton } from "@/components/ReportButton";
import { ShareCampagneButton } from "@/components/ShareCampagneButton";
import { RankBadge } from "@/components/ui/RankBadge";
import { VerifiedBadge } from "@/components/ui/VerifiedBadge";
import { ZoomablePhoto } from "@/components/ui/ZoomablePhoto";
import { formatDepuis } from "@/lib/badgesFidelite";
import {
  computeCampagneProgressPercent,
  computeCampagneStatus,
  computeJoursRestants,
  formatMontant,
} from "@/lib/campagnes";
import type { CreateurProfileData } from "@/lib/profil";
import type { OffreType } from "@/lib/validation";

// video/shoutout share the same reassurance copy (identical accept/deliver
// mechanics); don has no reassurance.whatsapp/contenu_debloque/etc key of
// its own to reuse, so this map is what ties each offer type to its
// message key rather than duplicating the video/shoutout string twice in
// the message files.
const REASSURANCE_KEYS: Partial<Record<OffreType, string>> = {
  whatsapp: "reassurance.whatsapp",
  video: "reassurance.videoShoutout",
  shoutout: "reassurance.videoShoutout",
  don: "reassurance.don",
  contenu_debloque: "reassurance.contenu_debloque",
  evenement_live: "reassurance.evenement_live",
};

// One emoji per offer type, purely decorative -- no icon library needed
// (design brief: no new heavy dependency without flagging it). "produit"
// (Phase 1 of the physical-product offer type) is included here only so
// this Record<OffreType, ...> stays exhaustive and type-checks -- there
// is no fan-facing UI for browsing/buying a produit offre yet (Phase 3,
// out of scope for this lot), so this entry is never actually reached in
// practice today.
const OFFER_ICONS: Record<OffreType, string> = {
  video: "🎬",
  don: "💛",
  whatsapp: "💬",
  shoutout: "📣",
  contenu_debloque: "🔓",
  evenement_live: "🎥",
  campagne: "🎯",
  produit: "📦",
};

// Simple links (no OAuth/account linking, migration 0011) -- one emoji
// per platform, same "no icon library" reasoning as OFFER_ICONS above.
const SOCIAL_LINK_ICONS = {
  tiktok: "🎵",
  instagram: "📸",
  youtube: "▶️",
  autre: "🔗",
} as const;

export function CreateurProfileView({ profile }: { profile: CreateurProfileData }) {
  const t = useTranslations("CreateurProfile");
  const tCommon = useTranslations("Common");
  const locale = useLocale();
  const labels: Record<string, string> = {
    video: t("offerTypes.video"),
    don: t("offerTypes.don"),
    whatsapp: t("offerTypes.whatsapp"),
    shoutout: t("offerTypes.shoutout"),
    contenu_debloque: t("offerTypes.contenu_debloque"),
    evenement_live: t("offerTypes.evenement_live"),
  };

  const {
    createurId,
    displayName,
    createurVerifie,
    bio,
    photoUrl,
    couvertureUrl,
    socialLinks,
    offres,
    campagnes,
    ranks,
    supporters,
    badgesFidelite,
    publications,
    viewerCanRepost,
    viewerId,
  } = profile;
  const hasSocialLinks = Object.values(socialLinks).some(Boolean);
  const hasRanks =
    ranks.volume !== null || ranks.reactivite !== null || ranks.progression !== null;

  return (
    <main className="mx-auto max-w-2xl flex flex-col pb-12">
      <div className="relative overflow-hidden rounded-b-[2.5rem] px-5 pt-4 pb-16">
        {couvertureUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- a
                signed R2 URL, not a static asset next/image can optimize. */}
            <img
              src={couvertureUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
            />
            {/* Overlay so the white text/icons below stay legible over an
                arbitrary uploaded photo, same reasoning the gradient
                fallback already provided for free. */}
            <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/10 to-black/50" />
          </>
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-brand-500 via-brand-600 to-accent-500" />
        )}

        <div className="relative flex justify-end">
          <ReportButton createurId={createurId} />
        </div>

        <div className="relative mt-1 flex flex-col items-center gap-3 text-center">
          {photoUrl ? (
            <ZoomablePhoto
              src={photoUrl}
              ariaLabel={tCommon("zoomProfilePhotoAriaLabel")}
              thumbnailClassName="h-24 w-24 rounded-full object-cover ring-4 ring-white/80 shadow-lg"
            />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-full bg-white/15 text-4xl ring-4 ring-white/40 shadow-lg">
              🙂
            </div>
          )}

          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-white">{displayName ?? t("heading")}</h1>
            {createurVerifie && <VerifiedBadge label={t("verified")} tone="onDark" />}
          </div>

          {bio && (
            <p className="max-w-xs text-sm leading-relaxed text-white/95">{bio}</p>
          )}

          {hasSocialLinks && (
            <div className="flex flex-wrap justify-center gap-2">
              {(Object.keys(SOCIAL_LINK_ICONS) as (keyof typeof SOCIAL_LINK_ICONS)[]).map(
                (platform) => {
                  const href = socialLinks[platform];
                  if (!href) {
                    return null;
                  }
                  return (
                    <a
                      key={platform}
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-4 py-1.5 text-sm font-medium text-white backdrop-blur-sm transition-transform active:scale-95 hover:bg-white/25"
                    >
                      {SOCIAL_LINK_ICONS[platform]} {t(`socialLinks.${platform}`)}
                    </a>
                  );
                },
              )}
            </div>
          )}
        </div>
      </div>

      {hasRanks && (
        <div className="-mt-8 flex flex-wrap justify-center gap-2 px-5">
          {ranks.volume !== null && (
            <RankBadge kind="volume" label={t("rankVolume", { rank: ranks.volume })} />
          )}
          {ranks.reactivite !== null && (
            <RankBadge
              kind="reactivite"
              label={t("rankReactivite", { rank: ranks.reactivite })}
            />
          )}
          {ranks.progression !== null && (
            <RankBadge
              kind="progression"
              label={t("rankProgression", { rank: ranks.progression })}
            />
          )}
        </div>
      )}

      {/* Opted-in fans supporting this créateur (migration 0022) --
          badges_fidelite_publics already filters to badge_fidelite_public
          = true, so every row here is already safe to show; nothing
          further to check in this component. */}
      {supporters.length > 0 && (
        <section className={`flex flex-col gap-2 px-5 ${hasRanks ? "mt-6" : "mt-8"}`}>
          <h2 className="text-lg font-bold">{t("badgeFidelite.supportersHeading")}</h2>
          <ul className="flex flex-col gap-1.5">
            {supporters.map((supporter) => (
              <li key={supporter.fanId} className="card px-3 py-2 text-sm">
                {t("badgeFidelite.supporterRow", {
                  name: supporter.displayName ?? t("badgeFidelite.anonymousSupporter"),
                  date: formatDepuis(supporter.depuis, locale),
                })}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className={supporters.length > 0 || hasRanks ? "mt-6" : "mt-8"}>
        <ProfileTabs
          offresContent={
            <>
              {campagnes.length > 0 && (
                <section className="flex flex-col gap-3 px-5">
                  <h2 className="text-lg font-bold">{t("campagnes.heading")}</h2>
                  {campagnes.map((campagne) => {
                    const status = computeCampagneStatus({
                      actif: campagne.actif,
                      montantCollecte: campagne.montantCollecte,
                      objectif: campagne.objectif,
                      dateFin: campagne.dateFin,
                    });
                    const progressPercent = computeCampagneProgressPercent(
                      campagne.montantCollecte,
                      campagne.objectif,
                    );
                    const joursRestants = computeJoursRestants(campagne.dateFin);

                    return (
                      // Stable anchor so "Partager cette campagne" can link
                      // straight at this one card, not just the profile in
                      // general -- scroll-mt-6 keeps it clear of any future
                      // sticky header even though there isn't one today.
                      <div
                        key={campagne.id}
                        id={`campagne-${campagne.id}`}
                        className="card scroll-mt-6 flex flex-col gap-3 p-4"
                      >
                        {/* 1. Title + status */}
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="font-semibold leading-snug">{campagne.titre}</h3>
                          {status === "objectif_atteint" && (
                            <span className="shrink-0 rounded-full bg-success-500/15 px-2.5 py-1 text-xs font-semibold text-success-600">
                              {t("campagnes.badgeObjectifAtteint")}
                            </span>
                          )}
                          {status === "terminee" && (
                            <span className="shrink-0 rounded-full bg-foreground-muted/15 px-2.5 py-1 text-xs font-semibold text-foreground-muted">
                              {t("campagnes.badgeTerminee")}
                            </span>
                          )}
                        </div>

                        {/* 2. Progress bar + montant collecté + pourcentage,
                            together -- the track itself carries a visible border
                            so it reads as a bar even at 0% filled, not just once
                            it starts filling in. */}
                        <div>
                          <div className="h-2 overflow-hidden rounded-full border border-border bg-surface-muted">
                            <div
                              className="h-full rounded-full bg-brand-500"
                              style={{ width: `${progressPercent}%` }}
                            />
                          </div>
                          <p className="mt-1.5 text-sm font-medium">
                            {t("campagnes.collecteEtPourcentage", {
                              collecte: formatMontant(campagne.montantCollecte, locale),
                              pourcentage: Math.round(progressPercent),
                            })}
                          </p>
                        </div>

                        {/* 3. Objectif + description of the cause */}
                        <div className="flex flex-col gap-1">
                          <p className="text-sm font-medium text-foreground-muted">
                            {t("campagnes.objectifLabel", {
                              objectif: formatMontant(campagne.objectif, locale),
                            })}
                          </p>
                          {campagne.description && (
                            <p className="text-sm text-foreground-muted">
                              {campagne.description}
                            </p>
                          )}
                          {status === "active" && joursRestants !== null && (
                            <p className="text-xs text-foreground-muted">
                              {joursRestants > 0
                                ? t("campagnes.joursRestants", { jours: joursRestants })
                                : t("campagnes.dernierJour")}
                            </p>
                          )}
                        </div>

                        {/* 4. Amount field + Payer button */}
                        {status === "active" && (
                          <div className="flex justify-end">
                            <CheckoutButton offreId={campagne.id} type="campagne" />
                          </div>
                        )}

                        <div className="border-t border-border pt-2">
                          <ShareCampagneButton campagneId={campagne.id} />
                        </div>
                      </div>
                    );
                  })}
                </section>
              )}

              <ul className={`flex flex-col gap-3 px-5 ${campagnes.length > 0 ? "mt-6" : ""}`}>
                {offres.map((offre) => (
                  <li key={offre.id} className="card flex flex-col gap-3 p-4">
                    <div className="flex items-center gap-3">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-xl dark:bg-white/10">
                        {OFFER_ICONS[offre.type]}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[0.95rem] font-semibold leading-snug">
                          {labels[offre.type] ?? offre.type}
                          {offre.libelle && ` · ${offre.libelle}`}
                        </p>
                        {offre.prix !== null && (
                          <p className="font-bold text-brand-600 dark:text-brand-300">
                            {offre.prix}$
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <CheckoutButton offreId={offre.id} type={offre.type} />
                    </div>
                    {/* Always-visible, not a hover tooltip: most visitors are on
                        mobile, where hover states aren't reachable at all. */}
                    {REASSURANCE_KEYS[offre.type] && (
                      <div className="flex items-start gap-1.5 border-t border-border pt-2.5">
                        <span aria-hidden className="mt-0.5 text-xs">
                          🛡️
                        </span>
                        <p className="text-xs leading-snug text-foreground-muted">
                          {t(REASSURANCE_KEYS[offre.type]!)}
                        </p>
                      </div>
                    )}
                  </li>
                ))}
                {offres.length === 0 && campagnes.length === 0 && (
                  <p className="text-center text-sm text-foreground-muted">
                    {t("noActiveOffers")}
                  </p>
                )}
              </ul>
            </>
          }
          publicationsContent={
            <div className="px-5">
              <PublicationsList
                publications={publications}
                canRepost={viewerCanRepost}
                viewerId={viewerId}
                expandable
              />
            </div>
          }
        />
      </div>

      {/* Créateurs THIS profile supports as a fan (migration 0022) --
          only ever non-empty when this profile owner's own
          badge_fidelite_public is true, since badges_fidelite_publics is
          filtered on the fan side regardless of which id it's queried
          by. Can co-exist with the "Supporters" section above -- this
          app has no fan/créateur role split, so the same person can
          both receive support and support others. */}
      {badgesFidelite.length > 0 && (
        <section className="mt-6 flex flex-col gap-2 px-5">
          <h2 className="text-lg font-bold">{t("badgeFidelite.badgesHeading")}</h2>
          <ul className="flex flex-col gap-1.5">
            {badgesFidelite.map((badge) => (
              <li key={badge.createurId} className="card px-3 py-2 text-sm">
                {t("badgeFidelite.badgeRow", {
                  createur: badge.displayName ?? t("badgeFidelite.anonymousCreateur"),
                  date: formatDepuis(badge.depuis, locale),
                })}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
