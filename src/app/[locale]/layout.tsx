import type { Metadata, Viewport } from "next";
import { hasLocale } from "next-intl";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Poppins } from "next/font/google";
import { routing } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Logo } from "@/components/Logo";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import "./globals.css";

// Rounded, friendly geometric sans -- matches the brief's "moderne,
// arrondie/friendly" direction. Self-hosted at build time by next/font
// (no runtime CDN request), subset to just the weights actually used and
// to latin + latin-ext so French accents (é, à, ç...) render correctly.
const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
});

export const viewport: Viewport = {
  themeColor: "#7c3aed",
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return {
    title: "FanBoss",
    description: t("description"),
    manifest: "/manifest.json",
  };
}

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  const t = await getTranslations({ locale, namespace: "Nav" });

  // Explorer is only shown to an already-authenticated visitor (product
  // decision) -- a logged-out visitor on signup/login shouldn't see it
  // pulling them away from finishing that flow.
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <html lang={locale} className={`${poppins.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        <NextIntlClientProvider>
          <ServiceWorkerRegistration />
          <div className="flex items-center justify-between px-4 py-3">
            <Link href="/" aria-label={t("homeAriaLabel")}>
              <Logo className="h-7 w-auto sm:h-8" />
            </Link>
            <div className="flex items-center gap-3">
              {/* Unlike Explorer (hidden pre-auth on purpose, so a
                  logged-out visitor on signup/login isn't pulled away
                  mid-flow), the leaderboard is deliberately public --
                  it's meant to be reachable without an account, so it's
                  shown to every visitor regardless of auth state. */}
              <Link
                href="/classement"
                className="text-sm font-semibold text-brand-600 dark:text-brand-300"
              >
                🏆 {t("classement")}
              </Link>
              {user && (
                <Link
                  href="/explorer"
                  className="text-sm font-semibold text-brand-600 dark:text-brand-300"
                >
                  🔎 {t("explorer")}
                </Link>
              )}
              <LanguageSwitcher />
            </div>
          </div>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
