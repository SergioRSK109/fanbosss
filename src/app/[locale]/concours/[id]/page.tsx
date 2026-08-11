import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { CheckoutButton } from "@/components/CheckoutButton";
import { ConcoursCountdown } from "@/components/ConcoursCountdown";
import { ShareCampagneButton } from "@/components/ShareCampagneButton";
import { buttonClass } from "@/components/ui/button-styles";
import { computeCampagneProgressPercent } from "@/lib/campagnes";
import { computeEqualSharePercent, formatPoints } from "@/lib/concours";
import { getConcoursPublicData } from "@/lib/concoursPublic";

// Public, no-auth page (brief point 4: a shared link must work for a
// visitor who's never logged in) -- reads concours_publics only, exactly
// the same shape /classement/@pseudo already establish for public
// discovery surfaces. The shared-screen split is a real numeric value
// (computeEqualSharePercent, migration 0045's own lib) rather than just
// "however many flex children happen to fit" -- each participant card
// gets an explicit flex-basis of 1/N of the row.
//
// Migration 0048: this is now the ONLY place a fan can pay into a
// concours' campagnes -- each participant's own auto-generated campagne
// (invisible everywhere else, see CLAUDE.md's "Creator contests --
// campagne auto-générée" section) is never shown/chosen anywhere else,
// so the "Participer" button below is genuinely load-bearing, not a
// convenience. Also renders an objectif_points progress bar and a
// temps_record countdown when the organizer configured either.
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
        {concours.dateDebut && !concours.ended && concours.dateDebutAVenir && (
          <p className="mt-1 text-sm text-foreground-muted">
            {t("ouvreLe", { date: new Date(concours.dateDebut).toLocaleString(locale) })}
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          <ConcoursCountdown targetDate={concours.dateFin} variant="fin" />
          {concours.tempsRecord && !concours.vainqueurObjectifId && (
            <ConcoursCountdown targetDate={concours.tempsRecord} variant="tempsRecord" />
          )}
        </div>
        <div className="mt-3">
          {/* Meant for a second phone filming the contest -- opens in a
              new tab (target="_blank") since the primary use is copying
              this exact URL onto that other device, not navigating away
              from this one. */}
          <Link
            href={`/concours/${concours.concoursId}/ecran`}
            target="_blank"
            className={buttonClass("outline", "sm")}
          >
            {t("ouvrirEcran")}
          </Link>
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

          // Migration 0048: once an objectif-based winner is determined
          // (concours_vainqueur_objectif -- rules 1/2, chronological
          // "reached it first"), that participant alone gets the
          // Vainqueur badge, regardless of `ended` -- the brief's own
          // "le concours peut afficher le résultat dès cet instant".
          // Nobody else gets "En tête" once that's decided; falling
          // back to the unchanged rule-3 (highest total) logic only
          // when no objectif-based winner exists at all.
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
            <div
              key={participant.createurId}
              style={{ flexBasis: `${sharePercent}%` }}
              className={`card flex min-w-[220px] grow flex-col items-center gap-3 p-5 text-center ${
                highlighted ? "border-2 border-brand-500" : "border border-border"
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
                {t("montantCollecte", { points: formatPoints(participant.montantCollecte, locale) })}
              </span>

              {progressPercent !== null && (
                <div className="w-full">
                  <div className="h-2 w-full overflow-hidden rounded-full border border-border bg-surface-muted">
                    <div
                      className="h-full rounded-full bg-brand-500"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-foreground-muted">
                    {t("objectifProgres", {
                      points: formatPoints(concours.objectifPoints ?? 0, locale),
                    })}
                  </p>
                </div>
              )}

              <CheckoutButton offreId={participant.campagneId} type="campagne" />
            </div>
          );
        })}
      </div>

      <ShareCampagneButton />
    </main>
  );
}
