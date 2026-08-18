"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { buttonClass } from "@/components/ui/button-styles";
import { CountrySelect } from "@/components/ui/CountrySelect";
import { inputClass, labelClass } from "@/components/ui/field-styles";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { COUNTRIES } from "@/lib/countries";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isAtLeast18, minBirthDateForSignup } from "@/lib/validation";

// Not COUNTRIES[0] -- the list is alphabetical now (see countries.ts),
// so the array's first entry is whatever sorts first in French, not RDC.
// FanBoss launched in Kinshasa; the signup form should still open on RDC
// by default regardless of where "RD Congo" happens to fall alphabetically.
const DEFAULT_COUNTRY = COUNTRIES.find((country) => country.code === "CD") ?? COUNTRIES[0];
// Combined with the space nom_affichage joins them with, this keeps the
// concatenated "{nom} {postnom}" within the column's 60-char constraint
// (users_nom_affichage_max_length, migration 0009) with margin to spare.
const NOM_MAX_LENGTH = 29;

// A GoTrue trigger failure is generically wrapped (e.g. "Database error
// saving new user"), never the raw Postgres constraint text -- but since
// the client already blocks an under-18 date before ever calling
// signUp(), any signup failure that still looks database-related at this
// point is most likely this same age gate (the only failure condition
// this feature adds), so it gets the friendly message here too rather
// than whatever the wrapper's generic text happens to say.
function looksLikeAgeConstraintFailure(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("date_naissance") ||
    normalized.includes("database error saving new user")
  );
}

export function SignupForm() {
  const t = useTranslations("Signup");
  const searchParams = useSearchParams();
  const parrainId = searchParams.get("ref");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [nom, setNom] = useState("");
  const [postnom, setPostnom] = useState("");
  const [dateNaissance, setDateNaissance] = useState("");
  const [countryCode, setCountryCode] = useState(DEFAULT_COUNTRY.code);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [province, setProvince] = useState("");
  const [ville, setVille] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "sent" | "error">(
    "idle",
  );
  const [errorMessage, setErrorMessage] = useState("");

  const country = COUNTRIES.find((c) => c.code === countryCode) ?? DEFAULT_COUNTRY;
  // Limits the native date picker itself so it never even offers an
  // under-18 date, on top of the real submit-time check below.
  const maxBirthDate = minBirthDateForSignup();

  function handleCountryChange(code: string) {
    setCountryCode(code);
    // The province dropdown's own values (or the meaning of a free-text
    // entry) are entirely different for the new country -- a previously
    // selected/typed value would silently point at the wrong region, or
    // at nothing at all, if left in place.
    setProvince("");
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setErrorMessage("");

    if (password !== confirmPassword) {
      setStatus("error");
      setErrorMessage(t("passwordMismatch"));
      return;
    }

    if (!isAtLeast18(dateNaissance)) {
      setStatus("error");
      setErrorMessage(t("ageRestriction"));
      return;
    }

    setStatus("loading");

    const telephone = phoneNumber
      ? `${country.dial}${phoneNumber.replace(/\D/g, "")}`
      : null;
    const nomAffichage = `${nom.trim()} ${postnom.trim()}`.trim();

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: {
          telephone,
          pays: country.name,
          province: province.trim() || null,
          ville: ville.trim() || null,
          nom_affichage: nomAffichage,
          date_naissance: dateNaissance,
          parrain_id: parrainId,
        },
      },
    });

    if (error) {
      setStatus("error");
      setErrorMessage(
        looksLikeAgeConstraintFailure(error.message) ? t("ageRestriction") : error.message,
      );
      return;
    }

    setStatus("sent");
  }

  if (status === "sent") {
    return (
      <main className="mx-auto max-w-sm px-5 py-10 text-center">
        <div className="card flex flex-col items-center gap-3 p-6">
          <span className="text-4xl">📬</span>
          <p className="text-foreground">{t("confirmationSent")}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-sm px-5 py-10">
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
          <div className="flex gap-2">
            <label className={`${labelClass} flex-1`}>
              <span>{t("nom")}</span>
              <input
                type="text"
                required
                maxLength={NOM_MAX_LENGTH}
                value={nom}
                onChange={(event) => setNom(event.target.value)}
                className={`${inputClass} w-full`}
              />
            </label>
            <label className={`${labelClass} flex-1`}>
              <span>{t("postnom")}</span>
              <input
                type="text"
                required
                maxLength={NOM_MAX_LENGTH}
                value={postnom}
                onChange={(event) => setPostnom(event.target.value)}
                className={`${inputClass} w-full`}
              />
            </label>
          </div>
          <label className={labelClass}>
            <span>{t("dateNaissance")}</span>
            <input
              type="date"
              required
              max={maxBirthDate}
              value={dateNaissance}
              onChange={(event) => setDateNaissance(event.target.value)}
              className={`${inputClass} w-full`}
            />
          </label>
          <label className={labelClass}>
            <span>{t("country")}</span>
            <CountrySelect
              countries={COUNTRIES}
              value={countryCode}
              onChange={handleCountryChange}
              noResultsLabel={t("countryNoResults")}
            />
          </label>
          <label className={labelClass}>
            <span>{t("phone")}</span>
            <div className="flex gap-2">
              <span
                className={`${inputClass} flex w-20 shrink-0 items-center justify-center px-2 text-center`}
                aria-hidden="true"
              >
                {country.dial || "—"}
              </span>
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
            <span>{t("province")}</span>
            {country.provinces && country.provinces.length > 0 ? (
              <select
                value={province}
                onChange={(event) => setProvince(event.target.value)}
                className={`${inputClass} w-full`}
              >
                <option value="">{t("provincePlaceholder")}</option>
                {country.provinces.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={province}
                onChange={(event) => setProvince(event.target.value)}
                maxLength={100}
                className={`${inputClass} w-full`}
              />
            )}
          </label>
          <label className={labelClass}>
            <span>{t("city")}</span>
            <input
              type="text"
              value={ville}
              onChange={(event) => setVille(event.target.value)}
              maxLength={100}
              className={`${inputClass} w-full`}
            />
          </label>
          <label className={labelClass}>
            <span>{t("password")}</span>
            <PasswordInput
              required
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label className={labelClass}>
            <span>{t("confirmPassword")}</span>
            <PasswordInput
              required
              minLength={8}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
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
