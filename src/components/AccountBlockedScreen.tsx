import { getTranslations } from "next-intl/server";
import { LogoutButton } from "@/components/LogoutButton";
import { buttonClass } from "@/components/ui/button-styles";
import type { AccountBlockInfo } from "@/lib/accountStatus";

// Rendered in place of any of the 5 AppTabBar-connected pages
// (/home, /offres, /finance, /explorer, /parametres) the instant a
// suspended/banned account's session next loads one of them -- migration
// 0052. No real-time push (this project has no realtime infrastructure
// at all, see CLAUDE.md), so a session that was already open when the
// admin action happened only sees this on its NEXT navigation/reload,
// exactly as specified.
//
// Carries its own LogoutButton: /parametres -- the only page that
// normally hosts one -- is itself one of the blocked pages, so without
// this a suspended/banned user would have no in-app way to sign out at
// all.
export async function AccountBlockedScreen({ info }: { info: AccountBlockInfo }) {
  const t = await getTranslations("AccountBlocked");
  const isBanni = info.statutCompte === "banni";

  return (
    <main className="mx-auto flex min-h-[70dvh] max-w-sm flex-col justify-center px-5 py-10 text-center">
      <div className="card flex flex-col items-center gap-3 p-6">
        <span className="text-4xl">{isBanni ? "⛔" : "⏸️"}</span>
        <h1 className="text-2xl font-bold">
          {t(isBanni ? "banniHeading" : "suspenduHeading")}
        </h1>
        <p className="text-sm text-foreground-muted">
          {t(isBanni ? "banniMessage" : "suspenduMessage")}
        </p>
        {info.raison && (
          <p className="rounded-2xl bg-surface-muted px-3 py-2 text-sm text-foreground">
            {t("raisonLabel", { raison: info.raison })}
          </p>
        )}
        <LogoutButton className={buttonClass("ghost", "sm", "mt-2")} />
      </div>
    </main>
  );
}
