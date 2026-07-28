"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { HeartIcon, MenuIcon, RepostIcon, ShareIcon } from "@/components/ui/icons";
import type { Publication } from "@/lib/publications";

// Lot 5c: like -> repost -> partager -> menu, left to right, exactly per
// the brief. Like/share update local state directly from the RPC's own
// response (both return the fresh count, so there's no need to re-fetch
// the whole page for a single counter to update) -- repost and mute
// instead call router.refresh(), since both actually change WHICH rows
// this page shows (a new repost row appears in the feed; a muted
// créateur's posts disappear from /home), not just a number on this one
// card.
export function PublicationActions({
  publication,
  canRepost,
}: {
  publication: Publication;
  // Same population as publier_message()'s own rule (verified créateur
  // or admin) -- computed once per page (see canManagePublications in
  // lib/publications.ts) and threaded down here, never re-derived
  // per-card.
  canRepost: boolean;
}) {
  const t = useTranslations("Publications.actions");
  const router = useRouter();

  const [liked, setLiked] = useState(publication.viewerAAime);
  const [likesCount, setLikesCount] = useState(publication.likesCount);
  const [likePending, setLikePending] = useState(false);

  const [shared, setShared] = useState(publication.viewerAPartage);
  const [partagesCount, setPartagesCount] = useState(publication.partagesCount);
  const [sharePending, setSharePending] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  const [reposted, setReposted] = useState(publication.viewerARepost);
  const [repostPending, setRepostPending] = useState(false);
  const [repostError, setRepostError] = useState(false);

  const [menuOpen, setMenuOpen] = useState(false);
  const [reportStatus, setReportStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [muteStatus, setMuteStatus] = useState<"idle" | "sending" | "error">("idle");

  // "Éligible" per the brief: verified créateur/admin, target still
  // public, its author still allows reposting, not already reposted by
  // this viewer, and the target isn't itself already a repost --
  // reposter_publication() re-checks every one of these server-side
  // regardless (never trust the client alone), this is purely what
  // decides whether the button renders at all.
  const canShowRepost =
    canRepost &&
    publication.repostDe === null &&
    publication.visibilite === "public" &&
    publication.autoriseRepost === "tous" &&
    !reposted;

  async function handleLike() {
    if (likePending) return;
    setLikePending(true);
    const response = await fetch(`/api/publications/${publication.id}/like`, { method: "POST" });
    if (response.ok) {
      const body = await response.json();
      setLiked(Boolean(body.liked));
      setLikesCount(Number(body.likesCount ?? 0));
    }
    setLikePending(false);
  }

  async function handleRepost() {
    if (repostPending || !canShowRepost) return;
    setRepostPending(true);
    setRepostError(false);
    const response = await fetch(`/api/publications/${publication.id}/repost`, { method: "POST" });
    if (response.ok) {
      setReposted(true);
      router.refresh();
    } else {
      setRepostError(true);
    }
    setRepostPending(false);
  }

  function permalienUrl() {
    const handle = publication.auteur.pseudo ? `@${publication.auteur.pseudo}` : publication.auteur.id;
    return `${window.location.origin}/${handle}/p/${publication.id}`;
  }

  async function handleShare() {
    if (sharePending) return;
    setSharePending(true);

    const response = await fetch(`/api/publications/${publication.id}/partager`, { method: "POST" });
    if (response.ok) {
      const body = await response.json();
      setShared(true);
      setPartagesCount(Number(body.partagesCount ?? partagesCount + 1));
    }

    const url = permalienUrl();
    if (navigator.share) {
      try {
        await navigator.share({ url });
      } catch {
        // The visitor closed the native share sheet -- not an error.
      }
    } else {
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    }
    setSharePending(false);
  }

  async function handleReport() {
    setReportStatus("sending");
    const response = await fetch(`/api/publications/${publication.id}/signaler`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    setReportStatus(response.ok ? "sent" : "error");
  }

  async function handleMute() {
    setMuteStatus("sending");
    const response = await fetch(`/api/createurs/${publication.auteur.id}/mute`, { method: "POST" });
    if (response.ok) {
      setMenuOpen(false);
      setMuteStatus("idle");
      router.refresh();
    } else {
      setMuteStatus("error");
    }
  }

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={handleLike}
        disabled={likePending}
        aria-pressed={liked}
        className={`flex items-center gap-1.5 text-sm font-medium transition-transform active:scale-95 ${
          liked ? "text-danger-500" : "text-foreground-muted hover:text-danger-500"
        }`}
      >
        <HeartIcon className="h-5 w-5" active={liked} />
        {likesCount > 0 && <span>{likesCount}</span>}
      </button>

      {canShowRepost && (
        <button
          type="button"
          onClick={handleRepost}
          disabled={repostPending}
          aria-pressed={reposted}
          className={`flex items-center gap-1.5 text-sm font-medium transition-transform active:scale-95 ${
            reposted ? "text-accent-500" : "text-foreground-muted hover:text-accent-500"
          }`}
        >
          <RepostIcon className="h-5 w-5" active={reposted} />
          {publication.repostsCount > 0 && <span>{publication.repostsCount}</span>}
        </button>
      )}

      <button
        type="button"
        onClick={handleShare}
        disabled={sharePending}
        aria-pressed={shared}
        className={`flex items-center gap-1.5 text-sm font-medium transition-transform active:scale-95 ${
          shared ? "text-accent-500" : "text-foreground-muted hover:text-accent-500"
        }`}
      >
        <ShareIcon className="h-5 w-5" active={shared} />
        {partagesCount > 0 && <span>{partagesCount}</span>}
      </button>

      <div className="relative ml-auto">
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="text-foreground-muted hover:text-foreground"
        >
          <MenuIcon className="h-5 w-5" />
        </button>

        {menuOpen && (
          <>
            {/* Invisible full-screen catcher so clicking anywhere outside
                the panel closes it -- simpler than a document-level
                listener for a menu this small. z-50, not z-10: this
                bar's own AppTabBar sibling (the shared (app) layout) is a
                fixed bottom nav at z-40 -- a card near the bottom of the
                viewport would otherwise sit UNDER the tab bar, which
                would then visually and interactively swallow clicks
                meant for the menu (caught live: Playwright reported the
                tab bar's own <Link> "intercepts pointer events" when
                trying to click a menu item). z-50 matches this project's
                existing convention for a full-screen overlay that must
                always win over the tab bar (ZoomablePhoto/PhotoCropper). */}
            <button
              type="button"
              aria-hidden
              tabIndex={-1}
              className="fixed inset-0 z-50 cursor-default"
              onClick={() => setMenuOpen(false)}
            />
            <div className="card absolute right-0 z-50 mt-2 flex w-56 flex-col gap-1 p-1.5 text-sm">
              {reportStatus === "sent" ? (
                <p className="px-3 py-2 text-foreground-muted">{t("reportSent")}</p>
              ) : (
                <button
                  type="button"
                  onClick={handleReport}
                  disabled={reportStatus === "sending"}
                  className="rounded-xl px-3 py-2 text-left text-foreground-muted hover:bg-surface-muted hover:text-foreground"
                >
                  {reportStatus === "sending" ? t("reportSending") : t("reportButton")}
                </button>
              )}
              <button
                type="button"
                onClick={handleMute}
                disabled={muteStatus === "sending"}
                className="rounded-xl px-3 py-2 text-left text-foreground-muted hover:bg-surface-muted hover:text-foreground"
              >
                {muteStatus === "sending" ? t("muteSending") : t("muteButton")}
              </button>
              {(reportStatus === "error" || muteStatus === "error") && (
                <p className="px-3 py-1 text-xs text-danger-600">{t("menuError")}</p>
              )}
            </div>
          </>
        )}
      </div>

      {shareCopied && <span className="text-xs text-accent-600">{t("shareCopied")}</span>}
      {repostError && <span className="text-xs text-danger-600">{t("repostError")}</span>}
    </div>
  );
}
