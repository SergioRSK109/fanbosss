"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { buttonClass } from "@/components/ui/button-styles";
import { inputClass, labelClass } from "@/components/ui/field-styles";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function LoginForm() {
  const t = useTranslations("Login");
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackError = searchParams.get("error");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("loading");
    setErrorMessage("");

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-[70dvh] max-w-sm flex-col justify-center px-5 py-10">
      <div className="card flex flex-col gap-6 p-6 shadow-sm">
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="text-4xl">👋</span>
          <h1 className="text-2xl font-bold">{t("heading")}</h1>
        </div>

        {callbackError && status !== "error" && (
          <p className="rounded-2xl bg-danger-500/10 px-4 py-2.5 text-sm text-danger-600">
            {t("callbackError", { error: callbackError })}
          </p>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className={labelClass}>
            <span>{t("email")}</span>
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={`${inputClass} w-full`}
            />
          </label>
          <label className={labelClass}>
            <span>{t("password")}</span>
            <input
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
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
