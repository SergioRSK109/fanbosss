"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Link } from "@/i18n/navigation";
import type { Notification } from "@/lib/notifications";

function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Lot 6b: the bell -- notifications/unreadCount are pre-fetched
// server-side (the shared (app) layout, same "pre-built content, client
// only toggles visibility" pattern as ProfileTabs/AdminTabs) and handed
// in as props. Opening the panel immediately marks every one of the
// caller's own notifications read (marquer_notifications_lues(),
// migration 0034) -- there is no per-notification "mark as read" RPC by
// design; clicking an individual row only ever navigates, since by the
// time it's clickable the whole batch was already marked read by the
// open itself.
export function NotificationBell({
  notifications,
  unreadCount,
}: {
  notifications: Notification[];
  unreadCount: number;
}) {
  const t = useTranslations("Notifications");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(unreadCount);

  async function handleToggle() {
    const nextOpen = !open;
    setOpen(nextOpen);

    if (nextOpen && count > 0) {
      const previousCount = count;
      setCount(0);
      const response = await fetch("/api/notifications/mark-read", { method: "POST" });
      if (response.ok) {
        router.refresh();
      } else {
        setCount(previousCount);
      }
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleToggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("ariaLabel")}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-lg hover:bg-surface-muted"
      >
        🔔
        {count > 0 && (
          <span className="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-500 px-1 text-[10px] font-bold text-white">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Same invisible full-screen catcher + z-50 convention as
              PublicationActions.tsx's own "..." menu -- this bell lives in
              the shared (app) layout, right alongside AppTabBar's fixed
              z-40 bottom nav, so the panel needs to win over it too. */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-50 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="card absolute right-0 z-50 mt-2 w-80 max-w-[90vw] overflow-hidden p-0">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-sm font-bold">{t("heading")}</h2>
            </div>
            {notifications.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-foreground-muted">{t("empty")}</p>
            ) : (
              <ul className="max-h-96 overflow-y-auto">
                {notifications.map((notification) => {
                  const message = t(`types.${notification.type}`, {
                    acteur: notification.acteurLabel ?? t("anonymousActeur"),
                  });
                  const row = (
                    <div className="flex flex-col gap-0.5 px-4 py-3 text-sm hover:bg-surface-muted">
                      <span>{message}</span>
                      <span className="text-xs text-foreground-muted">
                        {formatDate(notification.createdAt, locale)}
                      </span>
                    </div>
                  );
                  return (
                    <li key={notification.id} className="border-b border-border last:border-0">
                      {notification.href ? (
                        <Link href={notification.href} onClick={() => setOpen(false)}>
                          {row}
                        </Link>
                      ) : (
                        row
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
