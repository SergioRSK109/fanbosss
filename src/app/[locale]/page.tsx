import { getTranslations } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Logo } from "@/components/Logo";
import { buttonClass } from "@/components/ui/button-styles";
import { ShieldCheckIcon } from "@/components/ui/icons";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Placeholder logo slots for the 4 payment-method chips below the CTA --
// the real files (M-Pesa/Airtel Money/Orange Money/Visa-Mastercard) aren't
// sourced yet, per explicit instruction; kept as data so swapping each
// entry for a real `next/image` import from `public/payment-logos/` later
// is a one-line change per entry, not a redesign.
interface PaymentMethodLogo {
  slug: string;
  label: string;
}

const PAYMENT_METHOD_LOGOS: PaymentMethodLogo[] = [
  { slug: "mpesa", label: "M-Pesa" },
  { slug: "airtel-money", label: "Airtel Money" },
  { slug: "orange-money", label: "Orange Money" },
  { slug: "visa-mastercard", label: "Visa / Mastercard" },
];

// Landing-page redesign: shown to any visitor, no fan/créateur choice
// upfront -- this app has no such role split at all (see CLAUDE.md). An
// already-authenticated visitor is redirected straight to /home instead of
// seeing any intermediate screen -- same "no interstitial for a session
// that already exists" pattern login/page.tsx and signup/page.tsx already
// use for the exact same reason (product bug fix: this page used to show
// "Créer un compte"/"Se connecter" unconditionally, which is what made
// clicking the logo while logged in look like a logout -- see CLAUDE.md
// "Logo-click 'logout' bug" for the real trace behind this). Everything
// below only ever renders for a logged-out visitor.
export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Home" });
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect({ href: "/home", locale });
    return;
  }

  // "Boss" is colored separately from the rest of the accroche (same
  // coral as the logo wordmark's own "Boss", var(--color-accent-500)) --
  // per explicit instruction, this is done by splitting the *rendered*
  // string rather than adding a second translation key for that one word
  // alone. Both fr/en copies deliberately end with the literal word
  // "Boss" (kept untranslated, it's the brand name), so a plain
  // last-word split works for both locales.
  const titleWords = t("title").split(" ");
  const titleBoss = titleWords.pop();
  const titlePrefix = titleWords.join(" ");

  return (
    <div className="flex flex-1 flex-col">
      {/* Replaces TopNav on this route (see TopNav.tsx's own comment) --
          the splash screen just shown on app launch already carries the
          brand mark in full size, so this header stays a small reminder,
          not a repeat of it. */}
      <header className="flex items-center justify-between px-4 py-3">
        <Logo className="h-7 w-auto sm:h-8" />
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="text-sm font-medium text-foreground-muted transition-colors hover:text-foreground"
          >
            {t("login")}
          </Link>
          <span aria-hidden className="h-4 w-px bg-border" />
          <LanguageSwitcher />
        </div>
      </header>

      <main className="relative flex flex-1 flex-col items-center gap-6 overflow-hidden px-6 pt-8 pb-10 text-center">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -left-16 h-64 w-64 rounded-full bg-brand-400/30 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-20 -right-12 h-64 w-64 rounded-full bg-accent-400/30 blur-3xl"
        />

        <div className="relative flex flex-col items-center gap-3">
          <h1 className="text-xl font-medium text-foreground sm:text-2xl">
            {titlePrefix} <span className="text-accent-500">{titleBoss}</span>
          </h1>
          <p className="max-w-sm text-xs text-foreground-muted sm:text-sm">{t("tagline")}</p>
        </div>

        <div className="relative flex w-full max-w-xs flex-col gap-4">
          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs text-foreground-muted">
              <ShieldCheckIcon className="h-4 w-4 shrink-0" />
              <span>{t("paymentTrust")}</span>
            </div>
            <div className="grid w-full grid-cols-4 gap-2">
              {PAYMENT_METHOD_LOGOS.map((method) => (
                <div
                  key={method.slug}
                  className="flex h-10 items-center justify-center rounded-[7px] border border-dashed border-border bg-surface-muted px-1 text-center text-[9px] leading-tight font-medium text-foreground-muted"
                >
                  {method.label}
                </div>
              ))}
            </div>
          </div>

          <Link href="/signup" className={buttonClass("primary", "xl")}>
            {t("signup")}
          </Link>
        </div>
      </main>
    </div>
  );
}
