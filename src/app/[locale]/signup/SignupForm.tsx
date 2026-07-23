"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { COUNTRIES } from "@/lib/countries";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const DEFAULT_COUNTRY = COUNTRIES[0];

export function SignupForm() {
  const t = useTranslations("Signup");
  const searchParams = useSearchParams();
  const parrainId = searchParams.get("ref");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [countryCode, setCountryCode] = useState(DEFAULT_COUNTRY.code);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "sent" | "error">(
    "idle",
  );
  const [errorMessage, setErrorMessage] = useState("");

  const country = COUNTRIES.find((c) => c.code === countryCode) ?? DEFAULT_COUNTRY;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("loading");
    setErrorMessage("");

    const telephone = phoneNumber
      ? `${country.dial}${phoneNumber.replace(/\D/g, "")}`
      : null;

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: {
          telephone,
          pays: country.name,
          parrain_id: parrainId,
        },
      },
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
      <main className="mx-auto max-w-sm p-6">
        <p>{t("confirmationSent")}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="text-2xl font-semibold mb-6">{t("heading")}</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span>{t("email")}</span>
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="border rounded px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>{t("phone")}</span>
          <div className="flex gap-2">
            <select
              value={countryCode}
              onChange={(event) => setCountryCode(event.target.value)}
              className="border rounded px-2 py-2 max-w-[9.5rem]"
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} {c.dial && `(${c.dial})`}
                </option>
              ))}
            </select>
            <input
              type="tel"
              inputMode="numeric"
              value={phoneNumber}
              onChange={(event) => setPhoneNumber(event.target.value)}
              placeholder={t("phoneNumberPlaceholder")}
              className="border rounded px-3 py-2 flex-1"
            />
          </div>
        </label>
        <label className="flex flex-col gap-1">
          <span>{t("password")}</span>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="border rounded px-3 py-2"
          />
        </label>
        {status === "error" && (
          <p className="text-red-600 text-sm">{errorMessage}</p>
        )}
        <button
          type="submit"
          disabled={status === "loading"}
          className="bg-violet-600 text-white rounded px-3 py-2 disabled:opacity-50"
        >
          {status === "loading" ? t("submitting") : t("submit")}
        </button>
      </form>
    </main>
  );
}
