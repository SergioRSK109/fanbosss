import { getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { GalerieContent, type GalerieItemView } from "@/components/GalerieContent";
import { getGalerieFan } from "@/lib/galerie";
import { getSignedDownloadUrl } from "@/lib/r2";
import { resolveDisplayName } from "@/lib/profil";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Fan gallery (Phase 3/4): a fan's own private collection of everything
// they've received (delivered video/shoutout, non-expired
// contenu_debloque with a recognized media file -- see src/lib/galerie.ts
// for the exact scope, unchanged by this lot). Sits outside the (app)
// route group, same level as /explorer and /classement -- not one of the
// 5 AppTabBar destinations, since this lot deliberately doesn't wire in
// any entry point yet (Phase 4).
const PHOTO_SIGNED_URL_EXPIRY_SECONDS = 60 * 60 * 24; // 24h, same as every other profile photo in this app

export default async function GaleriePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  // Phase 4: a créateur's own public profile can deep-link here
  // (/galerie?createur={id}) once a fan has already received something
  // from them -- only ever a starting filter value, never a server-side
  // filter of its own (GalerieContent still fetches/holds the whole
  // gallery and filters client-side, same as before this lot).
  const initialCreateurId = typeof sp.createur === "string" ? sp.createur : null;
  const t = await getTranslations({ locale, namespace: "Galerie" });
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect({ href: "/login", locale });
    return;
  }

  // No createur filter at load -- the whole result is fetched once and
  // filtered client-side afterward (see GalerieContent), per the brief:
  // a personal collection, not a paginated public feed, so a server
  // round trip per filter change would be needless overhead here.
  const items = await getGalerieFan(user.id);

  const createurIds = Array.from(new Set(items.map((item) => item.createurId)));
  const { data: createurs } =
    createurIds.length > 0
      ? await supabase
          .from("profils_publics")
          .select("id, pseudo, nom_affichage, photo_r2_key")
          .in("id", createurIds)
      : { data: [] as { id: string; pseudo: string | null; nom_affichage: string | null; photo_r2_key: string | null }[] };

  const createurById = new Map(
    await Promise.all(
      (createurs ?? []).map(async (createur) => [
        createur.id,
        {
          displayName: resolveDisplayName(createur.nom_affichage, createur.pseudo),
          pseudo: createur.pseudo,
          photoUrl: createur.photo_r2_key
            ? await getSignedDownloadUrl(createur.photo_r2_key, PHOTO_SIGNED_URL_EXPIRY_SECONDS)
            : null,
        },
      ] as const),
    ),
  );

  const itemViews: GalerieItemView[] = items.map((item) => ({
    ...item,
    createur: createurById.get(item.createurId) ?? {
      displayName: null,
      pseudo: null,
      photoUrl: null,
    },
  }));

  return (
    <main className="mx-auto max-w-2xl px-4 pt-4 sm:px-5">
      <h1 className="text-2xl font-bold">{t("heading")}</h1>
      <p className="mt-1 text-sm text-foreground-muted">{t("subheading")}</p>

      <div className="mt-6">
        <GalerieContent items={itemViews} initialCreateurId={initialCreateurId} />
      </div>
    </main>
  );
}
