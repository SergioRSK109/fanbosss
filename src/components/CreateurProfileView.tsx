import { useTranslations } from "next-intl";
import { CheckoutButton } from "@/components/CheckoutButton";
import { ReportButton } from "@/components/ReportButton";
import type { CreateurProfileData } from "@/lib/profil";

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

  const { createurId, bio, photoUrl, lienReseauSocial, offres, ranks } = profile;
  const hasRanks =
    ranks.volume !== null || ranks.reactivite !== null || ranks.progression !== null;

  return (
    <main className="mx-auto max-w-2xl p-6 flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          {photoUrl && (
            // Signed R2 URL, not a static/optimizable asset Next's Image can cache.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoUrl}
              alt=""
              className="w-16 h-16 rounded-full object-cover border"
            />
          )}
          <div>
            <h1 className="text-2xl font-semibold">{t("heading")}</h1>
            {bio && <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">{bio}</p>}
            {lienReseauSocial && (
              <a
                href={lienReseauSocial}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-violet-600 underline"
              >
                {t("socialLink")}
              </a>
            )}
          </div>
        </div>
        <ReportButton createurId={createurId} />
      </div>

      {hasRanks && (
        <div className="flex flex-wrap gap-2">
          {ranks.volume !== null && (
            <span className="text-sm border rounded-full px-3 py-1">
              {t("rankVolume", { rank: ranks.volume })}
            </span>
          )}
          {ranks.reactivite !== null && (
            <span className="text-sm border rounded-full px-3 py-1">
              {t("rankReactivite", { rank: ranks.reactivite })}
            </span>
          )}
          {ranks.progression !== null && (
            <span className="text-sm border rounded-full px-3 py-1">
              {t("rankProgression", { rank: ranks.progression })}
            </span>
          )}
        </div>
      )}

      <ul className="flex flex-col gap-3">
        {offres.map((offre) => (
          <li
            key={offre.id}
            className="border rounded px-4 py-3 flex items-center justify-between"
          >
            <span>
              {labels[offre.type] ?? offre.type}
              {offre.libelle && ` (${offre.libelle})`}
              {offre.prix !== null && ` - ${offre.prix}$`}
            </span>
            <CheckoutButton offreId={offre.id} type={offre.type} />
          </li>
        ))}
        {offres.length === 0 && <p>{t("noActiveOffers")}</p>}
      </ul>
    </main>
  );
}
