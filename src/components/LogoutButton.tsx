"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { buttonClass } from "@/components/ui/button-styles";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type SignOutClient = { auth: { signOut: () => Promise<{ error: unknown }> } };
type NavigatingRouter = { push: (href: string) => void; refresh: () => void };

// Extracted from the component so it's unit-testable without a DOM
// renderer (this project has no jsdom/testing-library, see the other
// __tests__ dirs). Default signOut() scope is "global": it also revokes
// the refresh token server-side via the Supabase Auth API, not just
// clearing local cookies -- so a stolen/replayed refresh token can't
// resurrect the session either. Navigation only happens *after* signOut()
// resolves, so the redirect always reflects the now-invalidated session.
export async function signOutAndRedirect(supabase: SignOutClient, router: NavigatingRouter) {
  await supabase.auth.signOut();
  router.push("/");
  router.refresh();
}

export function LogoutButton({ className }: { className?: string }) {
  const t = useTranslations("LogoutButton");
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);
    await signOutAndRedirect(createSupabaseBrowserClient(), router);
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={loading}
      className={className ?? buttonClass("ghost", "sm")}
    >
      {loading ? t("loading") : t("button")}
    </button>
  );
}
