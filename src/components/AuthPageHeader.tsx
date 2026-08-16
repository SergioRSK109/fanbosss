import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Logo } from "@/components/Logo";

// Shared header for /signup and /login -- both routes are hidden from
// TopNav (see TopNav.tsx's own comment) specifically to drop the
// Classement link that used to sit there: a distraction mid-conversion,
// worse here than elsewhere since the visitor has already started
// investing in the form. What's left (logo, a link to the *other* auth
// page, the language switcher) is identical between the two pages
// except which page the link points at and what it says -- byte-identical
// otherwise, so it's extracted here rather than duplicated twice.
export async function AuthPageHeader({
  locale,
  linkHref,
  linkText,
}: {
  locale: string;
  linkHref: "/login" | "/signup";
  linkText: string;
}) {
  const tNav = await getTranslations({ locale, namespace: "Nav" });

  return (
    <header className="flex items-center justify-between px-4 py-3">
      <Link href="/" aria-label={tNav("homeAriaLabel")}>
        <Logo className="h-7 w-auto sm:h-8" />
      </Link>
      <div className="flex items-center gap-3">
        <Link
          href={linkHref}
          className="text-sm font-medium text-foreground-muted transition-colors hover:text-foreground"
        >
          {linkText}
        </Link>
        <span aria-hidden className="h-4 w-px bg-border" />
        <LanguageSwitcher />
      </div>
    </header>
  );
}
