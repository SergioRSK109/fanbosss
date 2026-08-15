import { useTranslations } from "next-intl";
import { VerifiedBadge } from "@/components/ui/VerifiedBadge";
import { Link } from "@/i18n/navigation";

// A visually distinct "locked" card, not CSS-blurred real text -- the
// server never even sends the real contenu/image_r2_key for a row this
// viewer isn't entitled to (publications_visibles, migration 0029), so
// there is nothing here for a client-side blur to hide in the first
// place; this component only ever receives what a teaser row actually
// carries (auteur + created_at + visibilite).
export function PublicationTeaser({
  auteurHref,
  auteurLabel,
  auteurVerifie = false,
}: {
  auteurHref: string;
  auteurLabel: string;
  auteurVerifie?: boolean;
}) {
  const t = useTranslations("Publications.teaser");
  const tCommon = useTranslations("Common");

  return (
    <div className="card flex flex-col items-center gap-2 border-dashed px-5 py-6 text-center">
      <span aria-hidden className="text-2xl">
        🔒
      </span>
      <p className="flex flex-wrap items-center justify-center gap-1.5 text-sm font-medium text-foreground-muted">
        {t("reservedTo", { auteur: auteurLabel })}
        {auteurVerifie && (
          <VerifiedBadge label={tCommon("verified")} tone="light" className="h-4 w-4 shrink-0" />
        )}
      </p>
      {/* Offres is already this profile's default tab (ProfileTabs), so a
          plain link to the profile itself lands there directly -- no
          query param/deep-link plumbing needed. */}
      <Link href={auteurHref} className="text-sm font-semibold text-brand-600 dark:text-brand-300">
        {t("cta")}
      </Link>
    </div>
  );
}
