import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export default function Home() {
  const t = useTranslations("Home");

  return (
    <main className="flex-1 flex flex-col items-center justify-center gap-6 p-6 text-center">
      <h1 className="text-4xl font-bold">{t("title")}</h1>
      <p className="max-w-md text-gray-600 dark:text-gray-300">{t("tagline")}</p>
      <div className="flex gap-4">
        <Link href="/signup" className="bg-violet-600 text-white rounded px-4 py-2">
          {t("signup")}
        </Link>
        <Link href="/login" className="border rounded px-4 py-2">
          {t("login")}
        </Link>
      </div>
    </main>
  );
}
