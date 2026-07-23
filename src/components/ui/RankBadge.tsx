// Real badge design for the three leaderboards (design brief point 4) --
// shared between the public profile and the dashboard so the same rank
// reads identically in both places.
const RANK_STYLES = {
  volume: "bg-gradient-to-br from-brand-500 to-brand-700",
  reactivite: "bg-gradient-to-br from-accent-400 to-accent-600",
  progression: "bg-gradient-to-br from-success-500 to-success-600",
} as const;

const RANK_ICONS = { volume: "🏆", reactivite: "⚡", progression: "📈" } as const;

export function RankBadge({
  kind,
  label,
}: {
  kind: keyof typeof RANK_STYLES;
  label: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-white shadow-sm ${RANK_STYLES[kind]}`}
    >
      <span aria-hidden>{RANK_ICONS[kind]}</span>
      {label}
    </span>
  );
}
