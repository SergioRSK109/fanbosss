"use client";

import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";

export function LanguageSwitcher() {
  const t = useTranslations("LanguageSwitcher");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  return (
    <select
      value={locale}
      onChange={(event) => router.replace(pathname, { locale: event.target.value })}
      className="border rounded px-2 py-1 text-sm"
      aria-label="Language"
    >
      <option value="fr">{t("fr")}</option>
      <option value="en">{t("en")}</option>
    </select>
  );
}
