import type { Metadata, Viewport } from "next";
import { hasLocale } from "next-intl";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Poppins } from "next/font/google";
import { routing } from "@/i18n/routing";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { TopNav } from "@/components/TopNav";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseTheme, THEME_COOKIE_NAME } from "@/lib/theme";
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
  modal,
  params,
}: Readonly<{
  children: React.ReactNode;
  // Lot 5d: the publication fullscreen-viewer parallel slot (see
  // src/app/[locale]/@modal) -- null on every route until an internal
  // navigation to /[handle]/p/[id] intercepts it. Rendered alongside
  // (not instead of) children, same "modal overlays the current page"
  // shape Next's own Parallel + Intercepting Routes docs describe.
  modal: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  // Explorer is only shown to an already-authenticated visitor (product
  // decision) -- a logged-out visitor on signup/login shouldn't see it
  // pulling them away from finishing that flow. TopNav also needs this to
  // decide whether to render LanguageSwitcher at all (hidden on the 5
  // AppTabBar-connected routes -- see TopNav's own comment).
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Read server-side, on every request, so the resolved theme is already
  // in the very first byte of HTML -- this is what makes the no-flash
  // guarantee possible without a client-side blocking script (see
  // CLAUDE.md's "Theme switcher" section). "system" deliberately sets NO
  // attribute at all: globals.css's light-dark()/@custom-variant
  // mechanism already treats the absence of data-theme as "follow the
  // OS", so there's nothing for this layout to compute or resolve itself.
  const cookieStore = await cookies();
  const theme = parseTheme(cookieStore.get(THEME_COOKIE_NAME)?.value);
  const htmlThemeProps = theme === "system" ? {} : { "data-theme": theme };

  return (
    <html
      lang={locale}
      className={`${poppins.variable} h-full antialiased`}
      {...htmlThemeProps}
    >
      <body className="min-h-full flex flex-col font-sans">
        <NextIntlClientProvider>
          <ServiceWorkerRegistration />
          <TopNav isAuthenticated={Boolean(user)} />
          {children}
          {modal}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
