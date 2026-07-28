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
  auteur: PublicationAuteur;
}

type PublicationVisibleRow = {
  id: string;
  auteur_id: string;
  type: PublicationType;
  contenu: string | null;
  image_r2_key: string | null;
  visibilite: PublicationVisibilite;
  created_at: string;
  contenu_complet: boolean;
};

const IMAGE_SIGNED_URL_EXPIRY_SECONDS = 60 * 60; // 1h -- a soutiens-only image is
// genuinely sensitive (unlike a profile photo), so this deliberately does NOT
// get the longer 24h expiry profile photos use; a fresh URL is minted on
// every render regardless, so staleness isn't a concern either way.

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

async function hydratePublications(
  supabase: SupabaseServerClient,
  rows: PublicationVisibleRow[],
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
          ? await getSignedDownloadUrl(row.image_r2_key, IMAGE_SIGNED_URL_EXPIRY_SECONDS)
          : null,
        auteur: {
          id: row.auteur_id,
          displayName: resolveDisplayName(profil?.nom_affichage ?? null, profil?.pseudo ?? null),
          pseudo: profil?.pseudo ?? null,
          photoUrl: photoUrlByAuteurId.get(row.auteur_id) ?? null,
        },
      };
    }),
  );
}

const PUBLICATIONS_SELECT =
  "id, auteur_id, type, contenu, image_r2_key, visibilite, created_at, contenu_complet";

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
