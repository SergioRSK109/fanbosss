import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { ConcoursCountdown } from "@/components/ConcoursCountdown";
import { ShareCampagneButton } from "@/components/ShareCampagneButton";
import { computeEqualSharePercent } from "@/lib/concours";
import { getConcoursPublicData } from "@/lib/concoursPublic";
import { formatMontant } from "@/lib/campagnes";

// Public, no-auth page (brief point 4: a shared link must work for a
// visitor who's never logged in) -- reads concours_publics only, exactly
// the same shape /classement/@pseudo already establish for public
// discovery surfaces. The shared-screen split is a real numeric value
// (computeEqualSharePercent, migration 0045's own lib) rather than just
// "however many flex children happen to fit" -- each participant card
// gets an explicit flex-basis of 1/N of the row.
export default async function ConcoursPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const t = await getTranslations({ locale, namespace: "Concours" });

  const concours = await getConcoursPublicData(id);

  if (!concours) {
    notFound();
  }

  const sharePercent = computeEqualSharePercent(concours.participants.length);
  // Highest montant first -- a fan opening the page should see who's
  // leading without having to scan every card.
  const participants = [...concours.participants].sort(
    (a, b) => b.montantCollecte - a.montantCollecte,
  );

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-5 pt-4">
      <div>
        {concours.trophyPhotoUrl && (
          // Signed R2 URL, not a static/optimizable asset Next's Image
          // can cache. Public per migration 0047 -- unlike
          // pourcentageMaitreJeu, the trophy photo is meant to be shown
          // on this exact page, to every visitor.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={concours.trophyPhotoUrl}
            alt={t("tropheeAlt")}
            className="mb-3 h-40 w-full rounded-2xl object-cover"
          />
        )}
        <h1 className="text-2xl font-bold">{concours.nom}</h1>
        <div className="mt-2">
          <ConcoursCountdown dateFin={concours.dateFin} />
        </div>
      </div>

      {participants.length === 0 && (
        <p className="text-sm text-foreground-muted">{t("aucunParticipant")}</p>
      )}

      <div className="flex flex-wrap gap-4">
        {participants.map((participant) => {
          const href = participant.pseudo
            ? `/@${participant.pseudo}`
            : `/createur/${participant.createurId}`;
          const badge = participant.isLeader
            ? concours.ended
              ? t("badgeVainqueur")
              : t("badgeEnTete")
            : null;

          return (
            <div
              key={participant.createurId}
              style={{ flexBasis: `${sharePercent}%` }}
              className={`card flex min-w-[220px] grow flex-col items-center gap-3 p-5 text-center ${
                participant.isLeader
                  ? "border-2 border-brand-500"
                  : "border border-border"
              }`}
            >
              <Link href={href} className="flex flex-col items-center gap-2">
                {participant.photoUrl ? (
                  // Signed R2 URL, not a static/optimizable asset Next's Image can cache.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={participant.photoUrl}
                    alt=""
                    className="h-16 w-16 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-50 text-2xl dark:bg-white/10">
                    🙂
                  </div>
                )}
                <span className="font-semibold">
                  {participant.displayName ?? t("createurAnonyme")}
                </span>
              </Link>

              {badge ? (
                <span className="rounded-full bg-brand-500/15 px-3 py-1 text-xs font-bold text-brand-600 dark:text-brand-300">
                  {badge}
                </span>
              ) : null}

              <span className="text-xl font-bold">
                {t("montantCollecte", { montant: formatMontant(participant.montantCollecte, locale) })}
              </span>
            </div>
          );
        })}
      </div>

      <ShareCampagneButton />
    </main>
  );
}
