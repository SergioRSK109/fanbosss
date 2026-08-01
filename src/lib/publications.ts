import { resolveDisplayName } from "@/lib/profil";
import { getSignedDownloadUrl } from "@/lib/r2";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Mirrors publier_message()'s own rate limit (migration 0029) -- purely
// descriptive (no UI currently reads it), never trusted as the real
// guarantee (the RPC re-checks this server-side regardless).
export const PUBLICATIONS_RATE_LIMIT_PER_24H = 10;

export type PublicationType = "createur" | "annonce_fanboss";
export type PublicationVisibilite = "public" | "soutiens";

export interface PublicationAuteur {
  id: string;
  displayName: string | null;
  pseudo: string | null;
  photoUrl: string | null;
}

export type AutoriseRepost = "personne" | "tous";

export interface Publication {
  id: string;
  type: PublicationType;
  visibilite: PublicationVisibilite;
  createdAt: string;
  // Explicit flag from publications_visibles -- never inferred from
  // contenu being null, matching the view's own reasoning (see migration
  // 0029). `false` means every field below except id/type/visibilite/
  // createdAt/auteur is a locked teaser and must not be rendered.
  contenuComplet: boolean;
  contenu: string | null;
  imageUrl: string | null;
  // Video support, additive alongside imageUrl (migration 0037) -- never
  // both set on the same publication (publications_media_exclusif).
  // Same teaser guarantee as imageUrl: null both when there's genuinely
  // no video AND whenever the current viewer can't see the full content.
  videoUrl: string | null;
  auteur: PublicationAuteur;
  // Lot 5c (migration 0031).
  autoriseRepost: AutoriseRepost;
  likesCount: number;
  partagesCount: number;
  repostsCount: number;
  viewerAAime: boolean;
  viewerAPartage: boolean;
  // Whether the CURRENT viewer has already reposted this exact
  // publication -- purely a UI eligibility signal (hide/disable the
  // repost button ahead of time); toggler_repost_publication() re-checks
  // this server-side regardless, same "never trust the client alone"
  // discipline as everywhere else in this project.
  viewerARepost: boolean;
  // Set only when this row is itself a repost (repost_de_id not null on
  // the underlying table) -- the referenced original, teaser-shaped for
  // the CURRENT viewer exactly like any other publication (a
  // soutiens-only original a stranger reposted still shows as a locked
  // teaser here, never the real content). Always null for a plain post.
  // Also null, never fetched, once the original has been masked --
  // publications_visibles' own masking-cascade already excludes a repost
  // of a masked original from the rows this function ever sees, so
  // there's nothing to embed by the time hydration runs. Never nested
  // more than one level deep -- the DB rejects reposting a repost
  // (toggler_repost_publication), so a repost's own repostDe is always
  // null.
  repostDe: Publication | null;
}

// Lot 5d (fullscreen viewer): the permalink URL for a given publication,
// or null when its author has no pseudo -- the permalink page 404s in
// that case (/[handle]/p/[id]'s own re-verification), same "no href
// beats a link guaranteed to 404" reasoning already applied to
// notificationHref() for publication_aimee. Pure, no data access, so
// call sites (PublicationCard, its own "..." menu, the fullscreen
// viewer's own content) never duplicate this string-building logic.
export function publicationPermalinkHref(
  publication: Pick<Publication, "id" | "auteur">,
): string | null {
  return publication.auteur.pseudo ? `/@${publication.auteur.pseudo}/p/${publication.id}` : null;
}

type PublicationVisibleRow = {
  id: string;
  auteur_id: string;
  type: PublicationType;
  contenu: string | null;
  image_r2_key: string | null;
  video_r2_key: string | null;
  visibilite: PublicationVisibilite;
  created_at: string;
  contenu_complet: boolean;
  repost_de_id: string | null;
  autorise_repost: AutoriseRepost;
  likes_count: number;
  partages_count: number;
  reposts_count: number;
  viewer_a_aime: boolean;
  viewer_a_partage: boolean;
  viewer_a_reposte: boolean;
};

const MEDIA_SIGNED_URL_EXPIRY_SECONDS = 60 * 60; // 1h -- a soutiens-only
// image or video is genuinely sensitive (unlike a profile photo), so this
// deliberately does NOT get the longer 24h expiry profile photos use; a
// fresh URL is minted on every render regardless, so staleness isn't a
// concern either way. Shared by both media kinds -- same sensitivity
// reasoning applies identically to either.

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface ViewerContext {
  // Null for a logged-out visitor -- every read path in this file
  // already tolerates that (publications_visibles/publications_accueil
  // both work fine for anon), this is purely what UI-layer code needs to
  // decide "is this MY publication" (the "..." menu, migration 0032).
  viewerId: string | null;
  // The exact same population publier_message()/
  // toggler_repost_publication() authorize server-side (verified
  // créateur or admin) -- computed once per page (composer visibility,
  // repost-button eligibility on every card on that page) rather than
  // re-derived per publication, and never trusted as the real guarantee
  // either way: both RPCs re-check this themselves regardless of what
  // this function returns.
  canManagePublications: boolean;
}

export async function getViewerContext(supabase: SupabaseServerClient): Promise<ViewerContext> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { viewerId: null, canManagePublications: false };
  }

  const { data } = await supabase
    .from("users")
    .select("est_admin, createur_verifie")
    .eq("id", user.id)
    .single();

  return {
    viewerId: user.id,
    canManagePublications: Boolean(data?.est_admin || data?.createur_verifie),
  };
}

async function hydratePublications(
  supabase: SupabaseServerClient,
  rows: PublicationVisibleRow[],
  // `false` for the recursive fetch of reposted originals below --
  // reposting a repost is already rejected at the DB level
  // (toggler_repost_publication), so every row fetched that way has its
  // own repost_de_id null and this flag is purely a cheap guard against
  // ever attempting a pointless extra round trip, not a real recursion
  // limit.
  embedReposts = true,
): Promise<Publication[]> {
  const auteurIds = Array.from(new Set(rows.map((row) => row.auteur_id)));

  const { data: profils } =
    auteurIds.length > 0
      ? await supabase
          .from("profils_publics")
          .select("id, pseudo, nom_affichage, photo_r2_key")
          .in("id", auteurIds)
      : {
          data: [] as {
            id: string;
            pseudo: string | null;
            nom_affichage: string | null;
            photo_r2_key: string | null;
          }[],
        };

  const profilById = new Map((profils ?? []).map((p) => [p.id, p]));

  // Resolved once per unique auteur, in parallel -- a busy poster's photo
  // shouldn't be re-signed once per one of their several posts.
  const photoUrlEntries = await Promise.all(
    auteurIds.map(async (id) => {
      const key = profilById.get(id)?.photo_r2_key ?? null;
      return [id, key ? await getSignedDownloadUrl(key, 60 * 60 * 24) : null] as const;
    }),
  );
  const photoUrlByAuteurId = new Map(photoUrlEntries);

  // A repost's original is fetched through the exact same
  // publications_visibles view, one batched query for every unique
  // repost_de_id in this page of rows -- so the referenced original is
  // teaser-shaped for the current viewer using the identical rule as
  // everything else (never a second, parallel visibility check). Only
  // ever non-empty ids that survived the view's own masking cascade
  // reach this point in the first place -- see publications_visibles'
  // own comment (migration 0031).
  const repostOriginalIds = embedReposts
    ? Array.from(new Set(rows.map((row) => row.repost_de_id).filter((id): id is string => id !== null)))
    : [];

  const { data: originalRows } =
    repostOriginalIds.length > 0
      ? await supabase.from("publications_visibles").select(PUBLICATIONS_SELECT).in("id", repostOriginalIds)
      : { data: [] as PublicationVisibleRow[] };

  const originalsById = new Map(
    repostOriginalIds.length > 0
      ? (await hydratePublications(supabase, originalRows ?? [], false)).map((p) => [p.id, p])
      : [],
  );

  return Promise.all(
    rows.map(async (row) => {
      const profil = profilById.get(row.auteur_id);
      return {
        id: row.id,
        type: row.type,
        visibilite: row.visibilite,
        createdAt: row.created_at,
        contenuComplet: row.contenu_complet,
        contenu: row.contenu,
        imageUrl: row.image_r2_key
          ? await getSignedDownloadUrl(row.image_r2_key, MEDIA_SIGNED_URL_EXPIRY_SECONDS)
          : null,
        videoUrl: row.video_r2_key
          ? await getSignedDownloadUrl(row.video_r2_key, MEDIA_SIGNED_URL_EXPIRY_SECONDS)
          : null,
        auteur: {
          id: row.auteur_id,
          displayName: resolveDisplayName(profil?.nom_affichage ?? null, profil?.pseudo ?? null),
          pseudo: profil?.pseudo ?? null,
          photoUrl: photoUrlByAuteurId.get(row.auteur_id) ?? null,
        },
        autoriseRepost: row.autorise_repost,
        likesCount: row.likes_count,
        partagesCount: row.partages_count,
        repostsCount: row.reposts_count,
        viewerAAime: row.viewer_a_aime,
        viewerAPartage: row.viewer_a_partage,
        viewerARepost: row.viewer_a_reposte,
        repostDe: row.repost_de_id ? (originalsById.get(row.repost_de_id) ?? null) : null,
      };
    }),
  );
}

const PUBLICATIONS_SELECT =
  "id, auteur_id, type, contenu, image_r2_key, video_r2_key, visibilite, created_at, contenu_complet, repost_de_id, autorise_repost, likes_count, partages_count, reposts_count, viewer_a_aime, viewer_a_partage, viewer_a_reposte";

// Backs the /[handle] and /createur/[id] profile pages' "Publications"
// tab -- every one of this créateur's own publications, teaser-shaped per
// viewer by publications_visibles (migration 0029). Deliberately not
// filtered by the auteur's current createur_verifie status (unlike
// getPublicationsAccueil below) -- a créateur's own profile keeps
// showing their past posts even if they later lose verified status; see
// CLAUDE.md for why that asymmetry is intentional.
export async function getPublicationsForAuteur(auteurId: string): Promise<Publication[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("publications_visibles")
    .select(PUBLICATIONS_SELECT)
    .eq("auteur_id", auteurId)
    .order("created_at", { ascending: false });

  return hydratePublications(supabase, data ?? []);
}

export const PUBLICATIONS_ACCUEIL_PAGE_SIZE = 10;

// Backs /home's global feed -- publications_accueil (migration 0029)
// already scopes this to currently-verified créateurs + FanBoss
// announcements; this function only adds pagination on top.
export async function getPublicationsAccueil(
  page: number,
): Promise<{ publications: Publication[]; total: number }> {
  const supabase = await createSupabaseServerClient();
  const offset = (page - 1) * PUBLICATIONS_ACCUEIL_PAGE_SIZE;

  const { data, count } = await supabase
    .from("publications_accueil")
    .select(PUBLICATIONS_SELECT, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + PUBLICATIONS_ACCUEIL_PAGE_SIZE - 1);

  const publications = await hydratePublications(supabase, data ?? []);
  return { publications, total: count ?? 0 };
}

// Backs the new permalink page (/@pseudo/p/[id], Lot 5c) -- a single
// publication, teaser-shaped for the current viewer exactly like every
// other read path, via the same publications_visibles view. Returns null
// both when the row genuinely doesn't exist and when it's masked (the
// view already excludes masque=true rows) -- the page can't and doesn't
// need to distinguish the two, same "404 either way" reasoning as
// getCreateurProfileData returning null for an unknown créateur id.
export async function getPublicationById(id: string): Promise<Publication | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("publications_visibles")
    .select(PUBLICATIONS_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (!data) {
    return null;
  }

  const [publication] = await hydratePublications(supabase, [data]);
  return publication;
}
