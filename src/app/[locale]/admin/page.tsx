import { notFound } from "next/navigation";
import { GestionAdminsManager, type AdminManageableUser } from "@/components/admin/GestionAdminsManager";
import {
  RemboursementsManuelsManager,
  type RemboursementManuel,
} from "@/components/admin/RemboursementsManuelsManager";
import { resolveDisplayName } from "@/lib/profil";
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";

// Business admin dashboard, gated by users.est_admin -- a real DB-level
// invariant (migration 0015's trigger), not just this check. A non-admin
// visitor (logged out, or logged in but not admin) gets a real 404, never
// a redirect -- a redirect to /login would itself reveal this page exists
// and is auth-gated, exactly the kind of leak brief explicitly asked to
// avoid.
export default async function AdminPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    notFound();
  }

  const { data: profil } = await supabase
    .from("users")
    .select("est_admin")
    .eq("id", user.id)
    .single();

  if (!profil?.est_admin) {
    notFound();
  }

  // Everything below reads across every user/transaction, far beyond what
  // users_select_self/RLS would ever allow this account directly -- safe
  // here specifically because the est_admin check above already
  // re-verified this exact caller server-side, same "verify with the real
  // client first, then use service-role for the privileged read" pattern
  // as the whatsapp-link/content-url delivery routes.
  const serviceSupabase = createSupabaseServiceRoleClient();

  const now = new Date();
  const startOfMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  ).toISOString();

  const [
    { data: monthTransactions },
    { data: manualRefundRows },
    { data: allUsers },
    { data: authUsersPage },
  ] = await Promise.all([
    serviceSupabase
      .from("transactions")
      .select("id, montant, createur_id")
      .gte("created_at", startOfMonth),
    serviceSupabase
      .from("transactions")
      .select("id, montant, created_at, createur_id, fan_id")
      .eq("necessite_remboursement_manuel", true)
      .order("created_at", { ascending: true }),
    serviceSupabase.from("users").select("id, pseudo, nom_affichage, est_admin"),
    serviceSupabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  const userLabelById = new Map(
    (allUsers ?? []).map((u) => [
      u.id,
      resolveDisplayName(u.nom_affichage, u.pseudo) ?? "(sans nom)",
    ]),
  );

  // Vue d'ensemble du mois en cours -- gross (all statuses, including
  // refused/refunded): "brut" is deliberately unadjusted, see CLAUDE.md.
  const transactionCount = monthTransactions?.length ?? 0;
  const gmvBrut = (monthTransactions ?? []).reduce(
    (sum, t) => sum + Number(t.montant),
    0,
  );
  const createursActifsCount = new Set(
    (monthTransactions ?? []).map((t) => t.createur_id),
  ).size;

  // Top 10 créateurs par volume ce mois -- same gross basis as GMV brut
  // above, for one consistent definition of "volume" on this page.
  const volumeByCreateur = new Map<string, number>();
  for (const t of monthTransactions ?? []) {
    volumeByCreateur.set(
      t.createur_id,
      (volumeByCreateur.get(t.createur_id) ?? 0) + Number(t.montant),
    );
  }
  const topCreateurs = [...volumeByCreateur.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([createurId, volume]) => ({
      createurId,
      label: userLabelById.get(createurId) ?? "(utilisateur supprimé)",
      volume,
    }));

  const remboursementsManuels: RemboursementManuel[] = (manualRefundRows ?? []).map((t) => ({
    id: t.id,
    montant: Number(t.montant),
    createdAt: t.created_at,
    createurLabel: userLabelById.get(t.createur_id) ?? "(utilisateur supprimé)",
    fanLabel: userLabelById.get(t.fan_id) ?? "(utilisateur supprimé)",
  }));

  const emailById = new Map(
    (authUsersPage?.users ?? []).map((u) => [u.id, u.email ?? null]),
  );

  const manageableUsers: AdminManageableUser[] = (allUsers ?? [])
    .map((u) => ({
      id: u.id,
      email: emailById.get(u.id) ?? null,
      label: resolveDisplayName(u.nom_affichage, u.pseudo) ?? u.id,
      estAdmin: u.est_admin,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 p-5 pb-16 sm:p-6">
      <h1 className="text-2xl font-bold">Administration</h1>

      <section>
        <h2 className="mb-3 text-lg font-bold">Vue d&apos;ensemble -- ce mois-ci</h2>
        <div className="grid grid-cols-3 gap-3">
          <div className="card px-4 py-3 text-center">
            <div className="text-2xl font-bold">{transactionCount}</div>
            <div className="text-xs text-foreground-muted">Transactions</div>
          </div>
          <div className="card px-4 py-3 text-center">
            <div className="text-2xl font-bold">{gmvBrut.toFixed(0)}$</div>
            <div className="text-xs text-foreground-muted">GMV brut</div>
          </div>
          <div className="card px-4 py-3 text-center">
            <div className="text-2xl font-bold">{createursActifsCount}</div>
            <div className="text-xs text-foreground-muted">Créateurs actifs</div>
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">
          Remboursements manuels en attente
          {remboursementsManuels.length > 0 && (
            <span className="ml-2 rounded-full bg-accent-500 px-2 py-0.5 text-xs font-bold text-white">
              {remboursementsManuels.length}
            </span>
          )}
        </h2>
        <p className="mb-3 text-sm text-foreground-muted">
          Transactions remboursées côté FanBoss mais pas encore réellement
          remboursées via CinetPay (voir CLAUDE.md &laquo;&nbsp;Automatic
          CinetPay refunds&nbsp;&raquo;). Une fois le remboursement fait
          manuellement dans le dashboard CinetPay, marque-le comme traité
          ici.
        </p>
        <RemboursementsManuelsManager remboursements={remboursementsManuels} />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">Top 10 créateurs par volume -- ce mois-ci</h2>
        {topCreateurs.length === 0 ? (
          <p className="text-sm text-foreground-muted">Aucune transaction ce mois-ci.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {topCreateurs.map((c, index) => (
              <li
                key={c.createurId}
                className="card flex items-center justify-between px-4 py-3"
              >
                <span className="text-sm font-medium">
                  #{index + 1} {c.label}
                </span>
                <span className="text-sm font-semibold text-brand-600 dark:text-brand-300">
                  {c.volume.toFixed(0)}$
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">Gestion des admins</h2>
        <GestionAdminsManager users={manageableUsers} />
      </section>
    </main>
  );
}
