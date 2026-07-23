"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { buttonClass } from "@/components/ui/button-styles";
import { inputClass, labelClass } from "@/components/ui/field-styles";
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
  const [bio, setBio] = useState("");
  const [lienReseauSocial, setLienReseauSocial] = useState("");
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
          bio: bio.trim() || null,
          lien_reseau_social: lienReseauSocial.trim() || null,
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
      <main className="mx-auto flex min-h-[70dvh] max-w-sm flex-col justify-center px-5 py-10 text-center">
        <div className="card flex flex-col items-center gap-3 p-6">
          <span className="text-4xl">📬</span>
          <p className="text-foreground">{t("confirmationSent")}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-sm flex-col justify-center px-5 py-10">
      <div className="card flex flex-col gap-6 p-6 shadow-sm">
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="text-4xl">✨</span>
          <h1 className="text-2xl font-bold">{t("heading")}</h1>
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
          <label className={labelClass}>
            <span>{t("phone")}</span>
            <div className="flex gap-2">
              <select
                value={countryCode}
                onChange={(event) => setCountryCode(event.target.value)}
                className={`${inputClass} w-[8.5rem] min-w-0 px-3`}
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
                className={`${inputClass} min-w-0 flex-1`}
              />
            </div>
          </label>
          <label className={labelClass}>
            <span>{t("bio")}</span>
            <textarea
              value={bio}
              onChange={(event) => setBio(event.target.value)}
              maxLength={500}
              rows={2}
              className={`${inputClass} w-full`}
            />
          </label>
          <label className={labelClass}>
            <span>{t("socialLinkLabel")}</span>
            <input
              type="url"
              value={lienReseauSocial}
              onChange={(event) => setLienReseauSocial(event.target.value)}
              placeholder="https://instagram.com/..."
              className={`${inputClass} w-full`}
            />
          </label>
          <label className={labelClass}>
            <span>{t("password")}</span>
            <input
              type="password"
              required
              minLength={8}
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
