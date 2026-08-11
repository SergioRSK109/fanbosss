import { iconForPalierDonateur } from "@/lib/donateurs";

// Same tone-based styling as VerifiedBadge -- "light" for a normal card
// background, "onDark" for CreateurProfileView's own brand-gradient
// header, where the light-mode style would be near-invisible.
const TONE_CLASSES = {
  light: "bg-brand-500/15 text-brand-600 dark:text-brand-300",
  onDark: "bg-white/20 text-white backdrop-blur-sm",
} as const;

export function DonorBadge({
  palier,
  label,
  tone = "light",
}: {
  palier: number;
  label: string;
  tone?: keyof typeof TONE_CLASSES;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold shadow-sm ${TONE_CLASSES[tone]}`}
    >
      <span aria-hidden>{iconForPalierDonateur(palier)}</span>
      {label}
    </span>
  );
}
