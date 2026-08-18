"use client";

import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const t = useTranslations("LanguageSwitcher");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  return (
    <select
      value={locale}
      onChange={(event) => router.replace(pathname, { locale: event.target.value })}
      className="border border-border bg-surface text-foreground-muted rounded-full px-3 py-1.5 text-xs font-medium"
      aria-label="Language"
    >
      <option value="fr">{compact ? t("frShort") : t("fr")}</option>
      <option value="en">{compact ? t("enShort") : t("en")}</option>
    </select>
  );
}
