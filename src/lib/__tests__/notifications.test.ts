import { describe, expect, it } from "vitest";
import { notificationHref } from "@/lib/notifications";

describe("notificationHref", () => {
  it("routes créateur-actionable and money-related types to /offres and /finance", () => {
    expect(notificationHref("demande_recue", { publicationId: null, viewerPseudo: null })).toBe(
      "/offres",
    );
    expect(notificationHref("don_recu", { publicationId: null, viewerPseudo: null })).toBe("/finance");
    expect(notificationHref("demande_acceptee", { publicationId: null, viewerPseudo: null })).toBe(
      "/finance",
    );
    expect(notificationHref("demande_refusee", { publicationId: null, viewerPseudo: null })).toBe(
      "/finance",
    );
    expect(notificationHref("video_livree", { publicationId: null, viewerPseudo: null })).toBe(
      "/finance",
    );
    expect(notificationHref("confirmation_recue", { publicationId: null, viewerPseudo: null })).toBe(
      "/finance",
    );
    expect(notificationHref("contestation_recue", { publicationId: null, viewerPseudo: null })).toBe(
      "/finance",
    );
    expect(
      notificationHref("litige_tranche_createur", { publicationId: null, viewerPseudo: null }),
    ).toBe("/finance");
    expect(notificationHref("litige_tranche_fan", { publicationId: null, viewerPseudo: null })).toBe(
      "/finance",
    );
    expect(notificationHref("retrait_traite", { publicationId: null, viewerPseudo: null })).toBe(
      "/finance",
    );
    expect(notificationHref("retrait_refuse", { publicationId: null, viewerPseudo: null })).toBe(
      "/finance",
    );
  });

  it("builds the permalink for publication_aimee when the viewer has both a pseudo and a publicationId", () => {
    expect(
      notificationHref("publication_aimee", { publicationId: "pub-1", viewerPseudo: "sergio" }),
    ).toBe("/@sergio/p/pub-1");
  });

  it("returns null for publication_aimee when the viewer has no pseudo -- no permalink route exists then", () => {
    expect(
      notificationHref("publication_aimee", { publicationId: "pub-1", viewerPseudo: null }),
    ).toBeNull();
  });

  it("returns null for publication_aimee when publicationId is somehow missing (defensive)", () => {
    expect(
      notificationHref("publication_aimee", { publicationId: null, viewerPseudo: "sergio" }),
    ).toBeNull();
  });

  it("returns null for avertissement_recu/compte_suspendu/compte_banni -- no bell navigation target, migration 0053", () => {
    expect(notificationHref("avertissement_recu", { publicationId: null, viewerPseudo: null })).toBeNull();
    expect(notificationHref("compte_suspendu", { publicationId: null, viewerPseudo: null })).toBeNull();
    expect(notificationHref("compte_banni", { publicationId: null, viewerPseudo: null })).toBeNull();
  });
});
