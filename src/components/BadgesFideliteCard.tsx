import { formatDepuis } from "@/lib/badgesFidelite";

// Private, self-only view of a fan's own loyalty badges -- unconditional
// on badge_fidelite_public (that flag only controls whether OTHERS see
// this, on the créateur's public profile and this fan's own public
// profile -- see migration 0022). Only rendered by the caller once
// there's at least one badge to show; no empty/zero state.
export function BadgesFideliteCard({
  badges,
}: {
  badges: { createurId: string; displayName: string | null; depuis: string }[];
}) {
  return (
    <section className="card flex flex-col gap-2 px-4 py-4">
      <h2 className="text-sm font-bold text-foreground-muted">Mes badges de fidélité</h2>
      <ul className="flex flex-col gap-1.5">
        {badges.map((badge) => (
          <li key={badge.createurId} className="text-sm">
            Supporter de{" "}
            <span className="font-semibold">{badge.displayName ?? "un créateur"}</span> depuis{" "}
            {formatDepuis(badge.depuis)}.
          </li>
        ))}
      </ul>
    </section>
  );
}
