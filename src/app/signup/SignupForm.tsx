"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function SignupForm() {
  const searchParams = useSearchParams();
  const parrainId = searchParams.get("ref");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"createur" | "fan">("fan");
  const [telephone, setTelephone] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "sent" | "error">(
    "idle",
  );
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("loading");
    setErrorMessage("");

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: {
          role,
          telephone: telephone || null,
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
        <p>Vérifiez votre boîte mail pour confirmer votre inscription.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="text-2xl font-semibold mb-6">Créer un compte FanBoss</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span>Je suis</span>
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as "createur" | "fan")}
            className="border rounded px-3 py-2"
          >
            <option value="fan">Fan</option>
            <option value="createur">Créateur</option>
          </select>
        </label>
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
          <span>Téléphone (WhatsApp)</span>
          <input
            type="tel"
            value={telephone}
            onChange={(event) => setTelephone(event.target.value)}
            placeholder="+243..."
            className="border rounded px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>Mot de passe</span>
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
          {status === "loading" ? "Création..." : "Créer mon compte"}
        </button>
      </form>
    </main>
  );
}
