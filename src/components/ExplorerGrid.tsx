"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { PublicationTile } from "@/components/PublicationTile";
import type { ExplorerCursor, Publication } from "@/lib/publications";

// Phase C: Explorer's publications grid, infinite-scroll on top of a
// server-rendered first batch. page.tsx fetches page 1 directly (no
// round trip needed for the very first paint) and passes it in as
// initial state; every subsequent batch comes from
// /api/explorer/publications as the sentinel below crosses into view.
//
// Keyed by `q` from the parent Server Component (see page.tsx) -- a new
// search is a plain GET navigation, and React only resets a client
// component's own useState across a prop change if its `key` actually
// changes; without that key, switching searches would keep showing the
// PREVIOUS query's already-loaded tiles underneath the new initial batch.
export function ExplorerGrid({
  initialPublications,
  initialCursor,
  q,
}: {
  initialPublications: Publication[];
  initialCursor: ExplorerCursor | null;
  q: string;
}) {
  const t = useTranslations("Explorer");
  const [publications, setPublications] = useState(initialPublications);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const loadMore = useCallback(async () => {
    if (loading || !cursor) {
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) {
        params.set("q", q);
      }
      params.set("cursorCreatedAt", cursor.createdAt);
      params.set("cursorId", cursor.id);

      const response = await fetch(`/api/explorer/publications?${params.toString()}`);
      if (!response.ok) {
        return;
      }
      const data: { publications: Publication[]; nextCursor: ExplorerCursor | null } =
        await response.json();
      setPublications((prev) => [...prev, ...data.publications]);
      setCursor(data.nextCursor);
    } finally {
      setLoading(false);
    }
  }, [cursor, loading, q]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMore();
        }
      },
      // Fires a little before the sentinel is literally on screen, so
      // the next batch is usually ready by the time the visitor actually
      // scrolls to the bottom.
      { rootMargin: "400px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  if (publications.length === 0) {
    return <p className="mt-10 text-center text-sm text-foreground-muted">{t("empty")}</p>;
  }

  return (
    <>
      <div className="grid grid-cols-3 gap-1">
        {publications.map((publication) => (
          <PublicationTile key={publication.id} publication={publication} />
        ))}
      </div>

      {cursor && <div ref={sentinelRef} aria-hidden className="h-1 w-full" />}
      {loading && (
        <p className="mt-4 text-center text-sm text-foreground-muted">{t("loadingMore")}</p>
      )}
    </>
  );
}
