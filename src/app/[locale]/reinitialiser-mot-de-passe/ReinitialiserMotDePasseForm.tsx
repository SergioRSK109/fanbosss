"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { buttonClass } from "@/components/ui/button-styles";
import { inputClass, labelClass } from "@/components/ui/field-styles";
import { useRouter } from "@/i18n/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function ReinitialiserMotDePasseForm() {
  const t = useTranslations("ReinitialiserMotDePasse");
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">(
    "idle",
  );
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setErrorMessage("");

    if (password !== confirmPassword) {
      setStatus("error");
      setErrorMessage(t("passwordMismatch"));
      return;
    }

    setStatus("loading");

    // No previous-password check: the session /auth/callback just
    // established from the emailed link is what authorizes this, same as
    // /parametres' password field for an already-logged-in visitor.
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
      return;
    }

    setStatus("done");
    router.push("/home");
    router.refresh();
  }

  if (status === "done") {
    return (
      <main className="mx-auto flex min-h-[70dvh] max-w-sm flex-col justify-center px-5 py-10 text-center">
        <div className="card flex flex-col items-center gap-3 p-6">
          <span className="text-4xl">✅</span>
          <p className="text-foreground">{t("success")}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-[70dvh] max-w-sm flex-col justify-center px-5 py-10">
      <div className="card flex flex-col gap-6 p-6 shadow-sm">
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="text-4xl">🔑</span>
          <h1 className="text-2xl font-bold">{t("heading")}</h1>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className={labelClass}>
            <span>{t("newPassword")}</span>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={`${inputClass} w-full`}
            />
          </label>
          <label className={labelClass}>
            <span>{t("confirmPassword")}</span>
            <input
              type="password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className={`${inputClass} w-full`}
            />
          </label>
          {status === "error" && (
            <p className="text-sm text-danger-600">{errorMessage}</p>
          )}
          <button
            type="submit"
            disabled={status === "loading"}
            className={buttonClass("primary", "lg", "mt-2")}
          >
            {status === "loading" ? t("submitting") : t("submit")}
          </button>
        </form>
      </div>
    </main>
  );
}
