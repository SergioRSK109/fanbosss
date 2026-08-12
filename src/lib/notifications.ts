import { resolveDisplayName } from "@/lib/profil";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

// Lot 6a (migration 0034) -- keep in sync with the notifications.type
// CHECK constraint, same "one enum, never a hand-copied duplicate"
// discipline as OFFRE_TYPES/PLATEFORME_LABELS elsewhere in this project.
export const NOTIFICATION_TYPES = [
  "demande_recue",
  "don_recu",
  "demande_acceptee",
  "demande_refusee",
  "video_livree",
  "confirmation_recue",
  "contestation_recue",
  "litige_tranche_createur",
  "litige_tranche_fan",
  "retrait_traite",
  "retrait_refuse",
  "publication_aimee",
  "avertissement_recu",
  "compte_suspendu",
  "compte_banni",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

// How many recent notifications the bell's dropdown shows -- this is a
// lightweight recent-activity panel, not a paginated history page (per
// the brief's own "liste déroulante" framing).
export const NOTIFICATIONS_PANEL_LIMIT = 20;

export interface Notification {
  id: string;
  type: NotificationType;
  transactionId: string | null;
  publicationId: string | null;
  lu: boolean;
  createdAt: string;
  // Resolved display name/pseudo of acteur_id, null when there's no
  // acteur (there never is for retrait_traite/retrait_refuse) or the
  // acteur's own profile can't be found (defensive only).
  acteurLabel: string | null;
  // Where clicking this notification should navigate -- computed once
  // here, server-side, rather than re-derived in the client component.
  // Null means "not clickable" (only reachable for publication_aimee
  // when the destinataire -- always the current viewer, for this type --
  // has no pseudo set, so no permalink route exists for their own post
  // yet; see notificationHref()'s own comment).
  href: string | null;
}

// Pure -- deliberately takes only the bits it needs (never the whole
// Notification/viewer objects) so it's unit-testable without a Supabase
// client. `viewerPseudo` is only ever consulted for `publication_aimee`:
// that type's destinataire is always the publication's own auteur (see
// migration 0034's toggler_like_publication() wiring -- a self-like
// never notifies), which for a caller reading their OWN notifications is
// always the current viewer, so their own pseudo is what the permalink
// needs.
export function notificationHref(
  type: NotificationType,
  params: { publicationId: string | null; viewerPseudo: string | null },
): string | null {
  switch (type) {
    case "publication_aimee":
      return params.publicationId && params.viewerPseudo
        ? `/@${params.viewerPseudo}/p/${params.publicationId}`
        : null;
    case "demande_recue":
      return "/offres";
    case "don_recu":
    case "demande_acceptee":
    case "demande_refusee":
    case "video_livree":
    case "confirmation_recue":
    case "contestation_recue":
    case "litige_tranche_createur":
    case "litige_tranche_fan":
    case "retrait_traite":
    case "retrait_refuse":
      return "/finance";
    // avertissement_recu/compte_suspendu/compte_banni: no navigation
    // target. A warning has its own dedicated, non-blocking banner
    // (AvertissementBanner.tsx, migration 0053) rather than routing
    // through the bell at all; a suspension/ban notification exists for
    // record-keeping (the same creer_notification() call every other
    // admin-triggered event already makes) but the destinataire can
    // never actually reach the bell to see it while blocked --
    // AccountBlockedScreen replaces the whole page, bell included.
    case "avertissement_recu":
    case "compte_suspendu":
    case "compte_banni":
      return null;
    default:
      return null;
  }
}

// Only ever the caller's own rows (notifications_select_own RLS,
// migration 0034) -- there is no p_destinataire_id parameter anywhere in
// this module, same "no way to ask for someone else's" shape as
// mes_progres_classement()/solde_wallet_createur().
export async function getNotifications(
  supabase: SupabaseServerClient,
  viewerPseudo: string | null,
): Promise<Notification[]> {
  const { data: rows } = await supabase
    .from("notifications")
    .select("id, type, transaction_id, publication_id, acteur_id, lu, created_at")
    .order("created_at", { ascending: false })
    .limit(NOTIFICATIONS_PANEL_LIMIT);

  const notificationRows = rows ?? [];
  const acteurIds = [
    ...new Set(notificationRows.map((row) => row.acteur_id).filter((id): id is string => id !== null)),
  ];

  const { data: acteurs } =
    acteurIds.length > 0
      ? await supabase.from("profils_publics").select("id, pseudo, nom_affichage").in("id", acteurIds)
      : { data: [] as { id: string; pseudo: string | null; nom_affichage: string | null }[] };

  const acteurById = new Map((acteurs ?? []).map((a) => [a.id, a]));

  return notificationRows.map((row) => {
    const acteur = row.acteur_id ? acteurById.get(row.acteur_id) : undefined;
    return {
      id: row.id,
      type: row.type as NotificationType,
      transactionId: row.transaction_id,
      publicationId: row.publication_id,
      lu: row.lu,
      createdAt: row.created_at,
      acteurLabel: acteur ? resolveDisplayName(acteur.nom_affichage, acteur.pseudo) : null,
      href: notificationHref(row.type as NotificationType, {
        publicationId: row.publication_id,
        viewerPseudo,
      }),
    };
  });
}

export async function getUnreadNotificationCount(supabase: SupabaseServerClient): Promise<number> {
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("lu", false);

  return count ?? 0;
}
