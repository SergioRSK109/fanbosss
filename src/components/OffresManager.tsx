"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { WHATSAPP_PRIX_MINIMUM } from "@/lib/validation";

type Offre = {
  id: string;
  type: "video" | "don" | "whatsapp";
  prix: number;
  actif: boolean;
};

export function OffresManager({ offres }: { offres: Offre[] }) {
  const router = useRouter();
  const [type, setType] = useState<"video" | "don" | "whatsapp">("video");
  const [prix, setPrix] = useState("10");
  const [errorMessage, setErrorMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setErrorMessage("");

    const response = await fetch("/api/offres", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, prix: Number(prix) }),
    });

    setLoading(false);

    if (!response.ok) {
      const body = await response.json();
      setErrorMessage(
        typeof body.error === "string" ? body.error : "création impossible",
      );
      return;
    }

    router.refresh();
  }

  async function toggleActif(offre: Offre) {
    await fetch(`/api/offres/${offre.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actif: !offre.actif }),
    });
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-6">
      <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span>Type</span>
          <select
            value={type}
            onChange={(event) =>
              setType(event.target.value as "video" | "don" | "whatsapp")
            }
            className="border rounded px-3 py-2"
          >
            <option value="video">Vidéo personnalisée</option>
            <option value="don">Don libre</option>
            <option value="whatsapp">Accès WhatsApp premium</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span>
            Prix ($){" "}
            {type === "whatsapp" && `(min ${WHATSAPP_PRIX_MINIMUM}$)`}
          </span>
          <input
            type="number"
            min={type === "whatsapp" ? WHATSAPP_PRIX_MINIMUM : 1}
            step="0.01"
            value={prix}
            onChange={(event) => setPrix(event.target.value)}
            className="border rounded px-3 py-2"
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="bg-violet-600 text-white rounded px-3 py-2 disabled:opacity-50"
        >
          {loading ? "..." : "Créer l'offre"}
        </button>
      </form>
      {errorMessage && <p className="text-red-600 text-sm">{errorMessage}</p>}

      <ul className="flex flex-col gap-2">
        {offres.map((offre) => (
          <li
            key={offre.id}
            className="border rounded px-3 py-2 flex items-center justify-between"
          >
            <span>
              {offre.type} - {offre.prix}$
              {!offre.actif && " (désactivée)"}
            </span>
            <button
              onClick={() => toggleActif(offre)}
              className="text-sm underline"
            >
              {offre.actif ? "désactiver" : "activer"}
            </button>
          </li>
        ))}
        {offres.length === 0 && <p>Aucune offre pour l&apos;instant.</p>}
      </ul>
    </section>
  );
}
