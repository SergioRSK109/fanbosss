"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/navigation";

// Broadcast screen (/concours/[id]/ecran) needs to stay current on a
// second phone filming it for the length of a live contest, with no one
// touching it. No new realtime infrastructure -- just a plain interval
// calling router.refresh(), which re-runs the page's own Server
// Component (the exact same getConcoursPublicData() call the page
// already makes on first render) and patches the RSC payload in place.
// No full navigation, no new query, no new data source.
export const ECRAN_REFRESH_INTERVAL_MS = 10_000;

export function EcranAutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => {
      router.refresh();
    }, ECRAN_REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [router]);

  return null;
}
