"use client";

import { useState } from "react";

export function ReportButton({ createurId }: { createurId: string }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "sent">("idle");

  async function submit(type: "signalement" | "blocage") {
    await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reportedUserId: createurId, type }),
    });
    setStatus("sent");
    setOpen(false);
  }

  if (status === "sent") {
    return <p className="text-sm text-gray-500">Signalement envoyé.</p>;
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        className="text-sm text-red-600 underline"
      >
        Signaler / bloquer
      </button>
      {open && (
        <div className="absolute z-10 mt-1 border rounded bg-white shadow p-2 flex flex-col gap-1">
          <button
            onClick={() => submit("signalement")}
            className="text-sm text-left px-2 py-1 hover:bg-gray-100"
          >
            Signaler ce créateur
          </button>
          <button
            onClick={() => submit("blocage")}
            className="text-sm text-left px-2 py-1 hover:bg-gray-100"
          >
            Bloquer ce créateur
          </button>
        </div>
      )}
    </div>
  );
}
