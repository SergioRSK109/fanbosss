import { useTranslations } from "next-intl";
import { CheckoutButton } from "@/components/CheckoutButton";
import { ReportButton } from "@/components/ReportButton";
import { RankBadge } from "@/components/ui/RankBadge";
import { ZoomablePhoto } from "@/components/ui/ZoomablePhoto";
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
// (design brief: no new heavy dependency without flagging it).
const OFFER_ICONS: Record<OffreType, string> = {
  video: "🎬",
  don: "💛",
  whatsapp: "💬",
  shoutout: "📣",
  contenu_debloque: "🔓",
  evenement_live: "🎥",
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
  const labels: Record<string, string> = {
    video: t("offerTypes.video"),
    don: t("offerTypes.don"),
    whatsapp: t("offerTypes.whatsapp"),
    shoutout: t("offerTypes.shoutout"),
    contenu_debloque: t("offerTypes.contenu_debloque"),
    evenement_live: t("offerTypes.evenement_live"),
  };

  const { createurId, displayName, bio, photoUrl, socialLinks, offres, ranks } = profile;
  const hasSocialLinks = Object.values(socialLinks).some(Boolean);
  const hasRanks =
    ranks.volume !== null || ranks.reactivite !== null || ranks.progression !== null;

  return (
    <main className="mx-auto max-w-md flex flex-col pb-12">
      <div className="rounded-b-[2.5rem] bg-gradient-to-br from-brand-500 via-brand-600 to-accent-500 px-5 pt-4 pb-16">
        <div className="flex justify-end">
          <ReportButton createurId={createurId} />
        </div>

        <div className="mt-1 flex flex-col items-center gap-3 text-center">
          {photoUrl ? (
            <ZoomablePhoto
              src={photoUrl}
              ariaLabel="Agrandir la photo de profil"
              thumbnailClassName="h-24 w-24 rounded-full object-cover ring-4 ring-white/80 shadow-lg"
            />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-full bg-white/15 text-4xl ring-4 ring-white/40 shadow-lg">
              🙂
            </div>
          )}

          <h1 className="text-xl font-bold text-white">{displayName ?? t("heading")}</h1>

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

      <ul className={`flex flex-col gap-3 px-5 ${hasRanks ? "mt-6" : "mt-8"}`}>
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
        {offres.length === 0 && (
          <p className="text-center text-sm text-foreground-muted">
            {t("noActiveOffers")}
          </p>
        )}
      </ul>
    </main>
  );
}
