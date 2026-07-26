// Shared between CreateurProfileView and /explorer's cards so the badge
// reads identically everywhere -- see migration 0023. Only ever rendered
// when users.createur_verifie is true (via profils_publics/
// profils_explorables), set exclusively by approuver_verification(); a
// créateur simply requesting verification never turns this on.
//
// `tone="onDark"` is for CreateurProfileView's header, which sits on a
// solid brand-gradient background -- the default brand-tinted style
// would be all but invisible there, so it gets a translucent white
// treatment instead, same idea as the social-link chips on that header.
const TONE_CLASSES = {
  light: "bg-brand-500/15 text-brand-600 dark:text-brand-300",
  onDark: "bg-white/20 text-white backdrop-blur-sm",
} as const;

export function VerifiedBadge({
  label,
  tone = "light",
}: {
  label: string;
  tone?: keyof typeof TONE_CLASSES;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${TONE_CLASSES[tone]}`}
    >
      <span aria-hidden>✓</span>
      {label}
    </span>
  );
}
