import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { GestionAdminsManager, type AdminManageableUser } from "@/components/admin/GestionAdminsManager";
import {
  RemboursementsManuelsManager,
  type RemboursementManuel,
} from "@/components/admin/RemboursementsManuelsManager";
import {
  VerificationsManager,
  type DemandeVerificationAdmin,
} from "@/components/admin/VerificationsManager";
import { resolveDisplayName } from "@/lib/profil";
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import type { PlateformeVerification } from "@/lib/verification";

// Business admin dashboard, gated by users.est_admin -- a real DB-level
// invariant (migration 0015's trigger), not just this check. A non-admin
// visitor (logged out, or logged in but not admin) gets a real 404, never
// a redirect -- a redirect to /login would itself reveal this page exists
// and is auth-gated, exactly the kind of leak brief explicitly asked to
// avoid.
export default async function AdminPage() {
  const t = await getTranslations("Admin");
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
    { data: verificationRows },
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
    // Only the two actionable statuses -- an approved/refused demande no
    // longer needs an admin decision, see VerificationsManager.
    serviceSupabase
      .from("demandes_verification")
      .select("id, createur_id, plateforme, lien_compte, code_verification, statut")
      .in("statut", ["en_attente", "conflit"])
      .order("created_at", { ascending: true }),
  ]);

  const userLabelById = new Map(
    (allUsers ?? []).map((u) => [
      u.id,
      resolveDisplayName(u.nom_affichage, u.pseudo) ?? t("noName"),
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
      label: userLabelById.get(createurId) ?? t("deletedUser"),
      volume,
    }));

  const remboursementsManuels: RemboursementManuel[] = (manualRefundRows ?? []).map((row) => ({
    id: row.id,
    montant: Number(row.montant),
    createdAt: row.created_at,
    createurLabel: userLabelById.get(row.createur_id) ?? t("deletedUser"),
    fanLabel: userLabelById.get(row.fan_id) ?? t("deletedUser"),
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

  const verifications: DemandeVerificationAdmin[] = (verificationRows ?? []).map((d) => ({
    id: d.id,
    createurLabel: userLabelById.get(d.createur_id) ?? t("deletedUser"),
    plateforme: d.plateforme as PlateformeVerification,
    lienCompte: d.lien_compte,
    codeVerification: d.code_verification,
    statut: d.statut as "en_attente" | "conflit",
  }));

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 p-5 pb-16 sm:p-6">
      <h1 className="text-2xl font-bold">{t("heading")}</h1>

      <section>
        <h2 className="mb-3 text-lg font-bold">{t("overviewHeading")}</h2>
        <div className="grid grid-cols-3 gap-3">
          <div className="card px-4 py-3 text-center">
            <div className="text-2xl font-bold">{transactionCount}</div>
            <div className="text-xs text-foreground-muted">{t("statTransactions")}</div>
          </div>
          <div className="card px-4 py-3 text-center">
            <div className="text-2xl font-bold">{gmvBrut.toFixed(0)}$</div>
            <div className="text-xs text-foreground-muted">{t("statGmvBrut")}</div>
          </div>
          <div className="card px-4 py-3 text-center">
            <div className="text-2xl font-bold">{createursActifsCount}</div>
            <div className="text-xs text-foreground-muted">{t("statCreateursActifs")}</div>
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">
          {t("remboursementsHeading")}
          {remboursementsManuels.length > 0 && (
            <span className="ml-2 rounded-full bg-accent-500 px-2 py-0.5 text-xs font-bold text-white">
              {remboursementsManuels.length}
            </span>
          )}
        </h2>
        <p className="mb-3 text-sm text-foreground-muted">{t("remboursementsIntro")}</p>
        <RemboursementsManuelsManager remboursements={remboursementsManuels} />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">{t("verificationHeading")}</h2>
        <p className="mb-3 text-sm text-foreground-muted">{t("verificationIntro")}</p>
        <VerificationsManager demandes={verifications} />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">{t("topCreateursHeading")}</h2>
        {topCreateurs.length === 0 ? (
          <p className="text-sm text-foreground-muted">{t("topCreateursEmpty")}</p>
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
        <h2 className="mb-3 text-lg font-bold">{t("gestionAdminsHeading")}</h2>
        <GestionAdminsManager users={manageableUsers} />
      </section>
    </main>
  );
}
