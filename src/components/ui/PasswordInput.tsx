"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { inputClass } from "@/components/ui/field-styles";
import { EyeIcon, EyeOffIcon } from "@/components/ui/icons";

// Shared show/hide toggle for every password field on the site (signup
// x2, login x1, réglages x2) -- built once here rather than duplicating
// the same local `visible` state + eye button five times. Reuses
// Common.showPassword/hidePassword (not a dedicated namespace) since
// this component is mounted from three different translation
// namespaces (Signup, Login, Parametres) and the aria-label text itself
// never varies by page.
//
// `type` is deliberately not a prop -- this component only ever renders
// a password field that can be revealed, never a generic text input, so
// letting a caller override `type` would defeat its own purpose.
type PasswordInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">;

export function PasswordInput(props: PasswordInputProps) {
  const t = useTranslations("Common");
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        {...props}
        type={visible ? "text" : "password"}
        className={`${inputClass} w-full pr-11`}
      />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? t("hidePassword") : t("showPassword")}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-foreground-muted transition-colors hover:text-foreground"
      >
        {visible ? <EyeOffIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
      </button>
    </div>
  );
}
