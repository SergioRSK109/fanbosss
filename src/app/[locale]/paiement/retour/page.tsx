import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export default function PaiementRetourPage() {
  const t = useTranslations("PaiementRetour");

  return (
    <main className="mx-auto flex min-h-[70dvh] max-w-sm flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="text-5xl">🎉</span>
      <h1 className="text-2xl font-bold">{t("heading")}</h1>
      <p className="text-foreground-muted">
        {t.rich("message", {
          link: (chunks) => (
            <Link href="/dashboard" className="font-semibold text-brand-600 dark:text-brand-300">
              {chunks}
            </Link>
          ),
        })}
      </p>
    </main>
  );
}
