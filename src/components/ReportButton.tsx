"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

export function ReportButton({ createurId }: { createurId: string }) {
  const t = useTranslations("CreateurProfile");
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
    return (
      <p className="rounded-full bg-white/15 px-3 py-1.5 text-xs text-white/90 backdrop-blur-sm">
        {t("reportSent")}
      </p>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        className="rounded-full bg-white/15 px-3 py-1.5 text-xs font-medium text-white/80 backdrop-blur-sm transition-transform active:scale-95 hover:bg-white/25 hover:text-white"
      >
        {t("reportOrBlock")}
      </button>
      {open && (
        <div className="card absolute right-0 z-10 mt-2 flex flex-col gap-0.5 p-1.5 shadow-lg">
          <button
            onClick={() => submit("signalement")}
            className="rounded-xl px-3 py-2 text-left text-sm text-foreground hover:bg-surface-muted"
          >
            {t("reportUser")}
          </button>
          <button
            onClick={() => submit("blocage")}
            className="rounded-xl px-3 py-2 text-left text-sm text-danger-500 hover:bg-surface-muted"
          >
            {t("blockUser")}
          </button>
        </div>
      )}
    </div>
  );
}
