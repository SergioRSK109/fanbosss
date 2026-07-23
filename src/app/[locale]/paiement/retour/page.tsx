import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export default function PaiementRetourPage() {
  const t = useTranslations("PaiementRetour");

  return (
    <main className="mx-auto max-w-sm p-6 flex flex-col gap-4 text-center">
      <h1 className="text-2xl font-semibold">{t("heading")}</h1>
      <p>
        {t.rich("message", {
          link: (chunks) => (
            <Link href="/dashboard" className="underline">
              {chunks}
            </Link>
          ),
        })}
      </p>
    </main>
  );
}
