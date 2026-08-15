import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { EcranAutoRefresh } from "@/components/EcranAutoRefresh";
import { VerifiedBadge } from "@/components/ui/VerifiedBadge";
import { computeCampagneProgressPercent } from "@/lib/campagnes";
import { formatPoints } from "@/lib/concours";
import { getConcoursPublicData } from "@/lib/concoursPublic";

// Broadcast screen -- built to be filmed on a second phone during a live
// contest (per the brief), so this route deliberately looks nothing like
// the rest of the app: fixed full-viewport dark background, always dark
// regardless of the visitor's own theme preference (a screen filmed
// through a camera needs consistent contrast, not whatever light/dark
// this particular phone happens to be in), huge typography, and no site
// chrome at all -- TopNav is hidden for this exact route (see
// TopNav.tsx's own ECRAN_ROUTE_PATTERN), and this route sits outside the
// (app) group so AppTabBar was never rendered here to begin with.
//
// No new data, no new query: reads the exact same getConcoursPublicData()
// (concoursPublic.ts) the normal /concours/[id] page already calls --
// same public, no-auth reasoning (a shared link/second-phone URL must
// work without a session). EcranAutoRefresh is what keeps it current
// without anyone touching the phone: a plain client-side interval
// calling router.refresh(), which just re-runs this Server Component
// (and therefore this exact same call) every 10s -- no realtime
// infrastructure, no second data path to keep in sync with the normal
// page.
export default async function ConcoursEcranPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const t = await getTranslations({ locale, namespace: "Concours" });
  const tCommon = await getTranslations({ locale, namespace: "Common" });

  const concours = await getConcoursPublicData(id);

  if (!concours) {
    notFound();
  }

  const participants = [...concours.participants].sort(
    (a, b) => b.montantCollecte - a.montantCollecte,
  );

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-black text-white">
      <EcranAutoRefresh />
      <main className="mx-auto flex min-h-full max-w-4xl flex-col items-center gap-8 px-6 py-10 sm:py-16">
        {concours.trophyPhotoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={concours.trophyPhotoUrl}
            alt={t("tropheeAlt")}
            className="h-28 w-28 rounded-3xl object-cover shadow-[0_0_40px_rgba(255,255,255,0.15)] sm:h-40 sm:w-40"
          />
        )}

        <div className="text-center">
          <h1 className="text-4xl font-black leading-tight sm:text-6xl">{concours.nom}</h1>
          {concours.ended && (
            <p className="mt-2 text-xl font-bold text-amber-300 sm:text-2xl">{t("termine")}</p>
          )}
        </div>

        {participants.length === 0 && (
          <p className="text-xl text-white/70">{t("aucunParticipant")}</p>
        )}

        <div className="flex w-full flex-col gap-5">
          {participants.map((participant) => {
            // Same winner-priority logic as the normal /concours/[id]
            // page (migration 0048): an objectif-based winner
            // (concours_vainqueur_objectif) always wins the badge over
            // the plain highest-total "En tête" state.
            const isWinnerByObjectif = concours.vainqueurObjectifId === participant.createurId;
            const badge = concours.vainqueurObjectifId
              ? isWinnerByObjectif
                ? t("badgeVainqueur")
                : null
              : participant.isLeader
                ? concours.ended
                  ? t("badgeVainqueur")
                  : t("badgeEnTete")
                : null;
            const highlighted = isWinnerByObjectif || (!concours.vainqueurObjectifId && participant.isLeader);
            const progressPercent = concours.objectifPoints
              ? computeCampagneProgressPercent(participant.montantCollecte, concours.objectifPoints)
              : null;

            return (
              // A vertical stack, not a 3-column row -- deliberately, not
              // a style preference: a fixed-size photo + shrink-0 points
              // display left zero width for the name at a real phone
              // viewport (390px), which truncated the name into an
              // overlapping mess (caught visually, not assumed fine from
              // reading the JSX). Stacking removes the horizontal
              // competition for space entirely, and lets every element
              // wrap/center naturally regardless of name length or point
              // count width.
              <div
                key={participant.createurId}
                className={`flex flex-col items-center gap-3 rounded-[2rem] border-4 p-6 text-center transition-transform sm:p-8 ${
                  highlighted
                    ? "scale-105 border-amber-300 bg-white/10 shadow-[0_0_50px_rgba(252,211,77,0.25)]"
                    : "border-white/15 bg-white/5"
                }`}
              >
                {participant.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={participant.photoUrl}
                    alt=""
                    className="h-24 w-24 rounded-full object-cover sm:h-32 sm:w-32"
                  />
                ) : (
                  <div className="flex h-24 w-24 items-center justify-center rounded-full bg-white/10 text-4xl sm:h-32 sm:w-32 sm:text-5xl">
                    🙂
                  </div>
                )}

                <p className="flex flex-wrap items-center justify-center gap-2 break-words text-2xl font-extrabold sm:text-4xl">
                  {participant.displayName ?? t("createurAnonyme")}
                  {participant.createurVerifie && (
                    <VerifiedBadge
                      label={tCommon("verified")}
                      tone="onDark"
                      className="h-6 w-6 shrink-0 sm:h-9 sm:w-9"
                    />
                  )}
                </p>

                {badge && (
                  <span className="rounded-full bg-amber-300/20 px-4 py-1.5 text-base font-bold text-amber-300 sm:text-lg">
                    {badge}
                  </span>
                )}

                <p className="text-4xl font-black tabular-nums sm:text-6xl">
                  {t("montantCollecte", { points: formatPoints(participant.montantCollecte, locale) })}
                </p>

                {progressPercent !== null && (
                  <div className="w-full max-w-xs">
                    <div className="h-3 w-full overflow-hidden rounded-full bg-white/15">
                      <div
                        className="h-full rounded-full bg-amber-300"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
