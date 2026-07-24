"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { buttonClass } from "@/components/ui/button-styles";
import { inputClass, labelClass } from "@/components/ui/field-styles";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function MotDePasseOublieForm() {
  const t = useTranslations("MotDePasseOublie");

  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "sent" | "error">(
    "idle",
  );
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("loading");
    setErrorMessage("");

    const supabase = createSupabaseBrowserClient();
    // Routed through /auth/callback (the same PKCE code-exchange handler
    // signup already uses, NOT a new route -- see CLAUDE.md "Email
    // confirmation / password reset link 404" for why reusing it matters
    // here) which then forwards to /reinitialiser-mot-de-passe once the
    // exchange has established a real session.
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?redirect=/reinitialiser-mot-de-passe`,
    });

    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
      return;
    }

    setStatus("sent");
  }

  if (status === "sent") {
    return (
      <main className="mx-auto flex min-h-[70dvh] max-w-sm flex-col justify-center px-5 py-10 text-center">
        <div className="card flex flex-col items-center gap-3 p-6">
          <span className="text-4xl">📬</span>
          <p className="text-foreground">{t("emailSent")}</p>
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
          <p className="text-sm text-foreground-muted">{t("instructions")}</p>
        </div>

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
