import { useTranslations } from "next-intl";
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
}: {
  auteurHref: string;
  auteurLabel: string;
}) {
  const t = useTranslations("Publications.teaser");

  return (
    <div className="card flex flex-col items-center gap-2 border-dashed px-5 py-6 text-center">
      <span aria-hidden className="text-2xl">
        🔒
      </span>
      <p className="text-sm font-medium text-foreground-muted">
        {t("reservedTo", { auteur: auteurLabel })}
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
