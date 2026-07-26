import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { buttonClass } from "@/components/ui/button-styles";
import { inputClass } from "@/components/ui/field-styles";
import { VerifiedBadge } from "@/components/ui/VerifiedBadge";
import { resolveDisplayName } from "@/lib/profil";
import { getSignedDownloadUrl } from "@/lib/r2";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { OFFRE_TYPES, escapeIlike, type OffreType } from "@/lib/validation";

const PAGE_SIZE = 12;
const PHOTO_SIGNED_URL_EXPIRY_SECONDS = 60 * 60 * 24; // 24h, matches the profile page (not sensitive).

function isOffreType(value: string): value is OffreType {
  return (OFFRE_TYPES as readonly string[]).includes(value);
}

// Public créateur directory (product brief): reads only from the public
// views (profils_explorables, offres_publiques) -- no auth required, no
// RLS-restricted table touched directly. See migration 0009 for how
// profils_explorables computes "has an active offre AND not
// masque_exploration" without ever exposing masque_exploration itself.
export default async function ExplorerPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: "Explorer" });
  const tOffers = await getTranslations({ locale, namespace: "CreateurProfile" });

  const rawType = typeof sp.type === "string" ? sp.type : "";
  const type = isOffreType(rawType) ? rawType : null;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const page = Math.max(1, Number(sp.page) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const supabase = await createSupabaseServerClient();

  // Type filter is a separate lookup: profils_explorables carries no offer
  // info, so narrow to créateur ids that have an active offre of that type
  // first, then filter the profile query by that id list.
  let matchingIds: string[] | null = null;
  if (type) {
    const { data: offresOfType } = await supabase
      .from("offres_publiques")
      .select("createur_id")
      .eq("type", type);
    matchingIds = Array.from(new Set((offresOfType ?? []).map((o) => o.createur_id)));
  }

  let results: {
    id: string;
    pseudo: string | null;
    bio: string | null;
    photo_r2_key: string | null;
    nom_affichage: string | null;
    createur_verifie: boolean;
  }[] = [];
  let total = 0;

  // Skip the query entirely when a type filter matched nobody -- avoids an
  // ambiguous empty .in() call and is just as correct.
  if (type === null || (matchingIds && matchingIds.length > 0)) {
    let query = supabase
      .from("profils_explorables")
      .select("id, pseudo, bio, photo_r2_key, nom_affichage, createur_verifie", { count: "exact" });

    if (q) {
      const escaped = escapeIlike(q);
      query = query.or(`pseudo.ilike.%${escaped}%,bio.ilike.%${escaped}%`);
    }
    if (matchingIds) {
      query = query.in("id", matchingIds);
    }

    const { data, count, error } = await query
      .order("date_creation", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (!error) {
      results = data ?? [];
      total = count ?? 0;
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const photoUrls = await Promise.all(
    results.map((profil) =>
      profil.photo_r2_key
        ? getSignedDownloadUrl(profil.photo_r2_key, PHOTO_SIGNED_URL_EXPIRY_SECONDS)
        : Promise.resolve(null),
    ),
  );

  function pageHref(targetPage: number) {
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    if (type) query.set("type", type);
    if (targetPage > 1) query.set("page", String(targetPage));
    const qs = query.toString();
    return `/explorer${qs ? `?${qs}` : ""}`;
  }

  return (
    <main className="mx-auto max-w-2xl px-5 pb-16 pt-4">
      <h1 className="text-2xl font-bold">{t("heading")}</h1>
      <p className="mt-1 text-sm text-foreground-muted">{t("subheading")}</p>

      <form method="get" className="mt-5 flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder={t("searchPlaceholder")}
          className={`${inputClass} w-full sm:flex-1`}
        />
        <select
          name="type"
          defaultValue={type ?? ""}
          className={`${inputClass} w-full sm:w-48`}
        >
          <option value="">{t("filterAll")}</option>
          {OFFRE_TYPES.map((offreType) => (
            <option key={offreType} value={offreType}>
              {tOffers(`offerTypes.${offreType}`)}
            </option>
          ))}
        </select>
        <button type="submit" className={buttonClass("primary", "md")}>
          {t("searchButton")}
        </button>
      </form>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {results.map((profil, index) => {
          const displayName = resolveDisplayName(profil.nom_affichage, profil.pseudo);
          const href = profil.pseudo ? `/@${profil.pseudo}` : `/createur/${profil.id}`;
          const photoUrl = photoUrls[index];

          return (
            <Link
              key={profil.id}
              href={href}
              className="card flex flex-col items-center gap-2 p-4 text-center transition-transform active:scale-95"
            >
              {photoUrl ? (
                // Signed R2 URL, not a static/optimizable asset Next's Image can cache.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photoUrl}
                  alt=""
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-50 text-2xl dark:bg-white/10">
                  🙂
                </div>
              )}
              <p className="w-full truncate text-sm font-semibold">
                {displayName ?? t("anonymous")}
              </p>
              {profil.createur_verifie && <VerifiedBadge label={tOffers("verified")} />}
              {profil.bio && (
                <p className="line-clamp-2 text-xs text-foreground-muted">{profil.bio}</p>
              )}
            </Link>
          );
        })}
      </div>

      {results.length === 0 && (
        <p className="mt-10 text-center text-sm text-foreground-muted">{t("empty")}</p>
      )}

      {totalPages > 1 && (
        <div className="mt-8 flex items-center justify-between">
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
