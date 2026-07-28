import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { PublicationComposer } from "@/components/PublicationComposer";
import { PublicationsList } from "@/components/PublicationsList";
import { getPublicationsAccueil, PUBLICATIONS_ACCUEIL_PAGE_SIZE } from "@/lib/publications";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Lot 5a: the "Accueil" tab -- unlike the other 4 AppTabBar destinations,
// this page is publicly browsable while logged out (the whole point of
// the visibility layer is that an anonymous visitor can see public posts
// and a locked teaser for soutiens-only ones, see publications_visibles/
// publications_accueil in migration 0029), so it deliberately does NOT
// redirect an unauthenticated visitor to /login the way /dashboard,
// /finance, /offres, /parametres all do.
export default async function HomePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: "HomePage" });
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The composer is shown only for an admin or a créateur_verifie (the
  // brief's own rule) -- but publier_message() re-checks this exact same
  // rule again server-side regardless of what this page decides to show,
  // same "never trust the client alone" discipline as everywhere else in
  // this project.
  let canCompose = false;
  if (user) {
    const { data: profil } = await supabase
      .from("users")
      .select("est_admin, createur_verifie")
      .eq("id", user.id)
      .single();
    canCompose = Boolean(profil?.est_admin || profil?.createur_verifie);
  }

  const page = Math.max(1, Number(sp.page) || 1);
  const { publications, total } = await getPublicationsAccueil(page);
  const totalPages = Math.max(1, Math.ceil(total / PUBLICATIONS_ACCUEIL_PAGE_SIZE));

  function pageHref(targetPage: number) {
    return targetPage > 1 ? `/home?page=${targetPage}` : "/home";
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-5 sm:p-6">
      <h1 className="text-2xl font-bold">{t("heading")}</h1>

      {canCompose && <PublicationComposer />}

      <PublicationsList publications={publications} />

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <Link
            href={pageHref(page - 1)}
            className={`text-sm font-semibold ${
              page <= 1
                ? "pointer-events-none text-foreground-muted/40"
                : "text-brand-600 dark:text-brand-300"
            }`}
          >
            ← {t("previous")}
          </Link>
          <span className="text-sm text-foreground-muted">
            {t("pageIndicator", { page, total: totalPages })}
          </span>
          <Link
            href={pageHref(page + 1)}
            className={`text-sm font-semibold ${
              page >= totalPages
                ? "pointer-events-none text-foreground-muted/40"
                : "text-brand-600 dark:text-brand-300"
            }`}
          >
            {t("next")} →
          </Link>
        </div>
      )}
    </main>
  );
}
