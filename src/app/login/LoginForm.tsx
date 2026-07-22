"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function LoginForm() {
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
    <main className="mx-auto max-w-sm p-6">
      <h1 className="text-2xl font-semibold mb-6">Connexion</h1>
      {callbackError && status !== "error" && (
        <p className="text-red-600 text-sm mb-4">
          La confirmation de votre compte a échoué : {callbackError}. Merci de
          vous connecter à nouveau.
        </p>
      )}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span>Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="border rounded px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>Mot de passe</span>
          <input
            type="password"
            required
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
          {status === "loading" ? "Connexion..." : "Se connecter"}
        </button>
      </form>
    </main>
  );
}
