import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { buttonClass } from "@/components/ui/button-styles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Shows a different CTA for an already-authenticated visitor (product
// bug fix: this page used to show "Créer un compte"/"Se connecter"
// unconditionally, which is what made clicking the logo while logged in
// look like a logout -- see CLAUDE.md "Logo-click 'logout' bug" for the
// real trace behind this).
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

  return (
    <main className="relative flex flex-1 flex-col items-center justify-center gap-10 overflow-hidden px-6 py-12 text-center">
      {/* Decorative color blobs, pure CSS -- no image assets to fetch on a
          slow connection. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -left-16 h-64 w-64 rounded-full bg-brand-400/30 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-20 -right-12 h-64 w-64 rounded-full bg-accent-400/30 blur-3xl"
      />

      <div className="relative flex flex-col items-center gap-4">
        <span className="text-5xl">🚀</span>
        <h1 className="bg-gradient-to-br from-brand-500 to-accent-500 bg-clip-text text-4xl font-extrabold text-transparent">
          {t("title")}
        </h1>
        <p className="max-w-xs text-foreground-muted">{t("tagline")}</p>
      </div>

      <div className="relative flex w-full max-w-xs flex-col gap-3">
        {user ? (
          <Link href="/dashboard" className={buttonClass("primary", "lg")}>
            {t("dashboard")}
          </Link>
        ) : (
          <>
            <Link href="/signup" className={buttonClass("primary", "lg")}>
              {t("signup")}
            </Link>
            <Link href="/login" className={buttonClass("outline", "lg")}>
              {t("login")}
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
