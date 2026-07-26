import { getTranslations } from "next-intl/server";
import {
  computeProgressPercent,
  computeReactiviteProgressPercent,
  describeProgressionProgres,
  describeReactiviteProgres,
  describeVolumeProgres,
  type ProgresClassement,
} from "@/lib/classementProgres";

// Private, self-only progress towards the three leaderboards -- fed by
// mes_progres_classement() (migration 0019), which only ever computes for
// the calling créateur (see that migration's comment for why this is a
// SECURITY DEFINER function rather than a view). Deliberately a separate
// card from the public-rank RankBadges already shown above it on the
// dashboard: those come straight from the public classement_* views
// (rank only), this one shows the real numbers behind the rank.
function ProgressRow({
  icon,
  label,
  percent,
  description,
}: {
  icon: string;
  label: string;
  percent: number;
  description: string;
}) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <span aria-hidden>{icon}</span>
        {label}
      </p>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full border border-border bg-surface-muted">
        <div
          className="h-full rounded-full bg-brand-500"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="mt-1.5 text-xs text-foreground-muted">{description}</p>
    </div>
  );
}

export async function ClassementProgresCard({ progres }: { progres: ProgresClassement }) {
  const t = await getTranslations("Dashboard.classementProgres");

  return (
    <section className="card flex flex-col gap-4 px-4 py-4">
      <h2 className="text-sm font-bold text-foreground-muted">{t("heading")}</h2>

      <ProgressRow
        icon="🏆"
        label={t("labelVolume")}
        percent={computeProgressPercent(progres.volumeActuel, progres.volumeSeuilTop10)}
        description={describeVolumeProgres(progres.volumeManque, t)}
      />

      <ProgressRow
        icon="⚡"
        label={t("labelReactivite")}
        percent={computeReactiviteProgressPercent(
          progres.reactiviteActuelleSecondes,
          progres.reactiviteSeuilTop10Secondes,
        )}
        description={describeReactiviteProgres(
          progres.reactiviteActuelleSecondes,
          progres.reactiviteManqueSecondes,
          t,
        )}
      />

      <ProgressRow
        icon="📈"
        label={t("labelProgression")}
        percent={
          progres.progressionEligible
            ? computeProgressPercent(
                progres.progressionActuel ?? 0,
                progres.progressionSeuilTop10,
              )
            : 0
        }
        description={describeProgressionProgres(
          progres.progressionEligible,
          progres.progressionManque,
          t,
        )}
      />
    </section>
  );
}
