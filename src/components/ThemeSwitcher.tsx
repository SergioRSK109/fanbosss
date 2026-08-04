"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MoonIcon, SunIcon, SystemIcon } from "@/components/ui/navIcons";
import type { Theme } from "@/lib/theme";

const OPTIONS: { value: Theme; Icon: typeof SunIcon; labelKey: "light" | "dark" | "system" }[] = [
  { value: "light", Icon: SunIcon, labelKey: "light" },
  { value: "dark", Icon: MoonIcon, labelKey: "dark" },
  { value: "system", Icon: SystemIcon, labelKey: "system" },
];

// Segmented control, not a <select> like LanguageSwitcher -- three
// mutually-exclusive, visually distinct choices read better as buttons
// than as a dropdown that hides two of the three options until opened
// (per the brief's own preference). `router.refresh()` after the POST is
// what makes a click take visual effect immediately: the cookie write
// itself has no effect on the ALREADY-RENDERED page, only on the NEXT
// server render -- refresh() is exactly that next server render, for the
// current URL, without a full navigation/reload. This is deliberately
// the only place client code ever touches data-theme -- the root layout
// (src/app/[locale]/layout.tsx) is still the one and only place that
// actually sets the attribute, so there's no risk of this component's
// own state ever disagreeing with what the server rendered.
export function ThemeSwitcher({ theme }: { theme: Theme }) {
  const t = useTranslations("Parametres.theme");
  const router = useRouter();
  const [pending, setPending] = useState<Theme | null>(null);

  async function handleSelect(value: Theme) {
    if (value === theme || pending) {
      return;
    }
    setPending(value);
    try {
      await fetch("/api/theme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: value }),
      });
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-border bg-surface p-1">
      {OPTIONS.map(({ value, Icon, labelKey }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => handleSelect(value)}
            aria-pressed={active}
            aria-label={t(`${labelKey}AriaLabel`)}
            disabled={pending !== null}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60 ${
              active
                ? "bg-brand-500 text-white"
                : "text-foreground-muted hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4" active={active} />
            {t(labelKey)}
          </button>
        );
      })}
    </div>
  );
}
