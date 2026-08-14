import { describe, expect, it } from "vitest";
import {
  buildPublicationSignalee,
  type PublicationOriginalRow,
  type PublicationSignaleeRow,
} from "@/lib/adminPublicationsSignalees";

const DELETED_USER_LABEL = "(utilisateur supprimé)";
const AUTOMATIQUE_LABEL = "Modération automatique";

describe("buildPublicationSignalee", () => {
  it("shows the publication's own contenu for a plain (non-repost) signalement", () => {
    const row: PublicationSignaleeRow = {
      reportId: "report-1",
      type: "signalement",
      raison: "spam",
      createdAt: "2026-01-01T00:00:00Z",
      reporterId: "fan-1",
      reportedUserId: "createur-1",
      publication: { id: "pub-1", contenu: "Un vrai message.", repostDeId: null },
    };
    const originalById = new Map<string, PublicationOriginalRow>();
    const pseudoById = new Map<string, string | null>([["createur-1", "sergio"]]);
    const labelById = new Map<string, string>([
      ["fan-1", "Fan Un"],
      ["createur-1", "Sergio Créateur"],
    ]);

    const result = buildPublicationSignalee(
      row,
      originalById,
      pseudoById,
      labelById,
      DELETED_USER_LABEL,
      AUTOMATIQUE_LABEL,
    );

    expect(result.id).toBe("pub-1");
    expect(result.contenu).toBe("Un vrai message.");
    expect(result.isRepost).toBe(false);
    expect(result.repostOriginalLabel).toBeNull();
    expect(result.pseudo).toBe("sergio");
    expect(result.auteurLabel).toBe("Sergio Créateur");
    expect(result.reporterLabel).toBe("Fan Un");
    expect(result.isAutomatique).toBe(false);
  });

  // The real bug this fix addresses: a repost's own `contenu` column is
  // always NULL (publications_contenu_coherent, migration 0031) -- a
  // naive read of the reported publication's own contenu would show the
  // admin a blank card with no explanation. This must resolve to the
  // ORIGINAL's real contenu instead, and flag clearly that it's a repost.
  it("shows the ORIGINAL's contenu for a repost signalement, never blank", () => {
    const row: PublicationSignaleeRow = {
      reportId: "report-2",
      type: "signalement",
      raison: null,
      createdAt: "2026-01-02T00:00:00Z",
      reporterId: "fan-1",
      // The reported author is the REPOSTER (createur-2), not the
      // original's author (createur-1) -- signaler_publication() sets
      // reported_user_id to the reported publication's own auteur_id.
      reportedUserId: "createur-2",
      publication: { id: "repost-1", contenu: null, repostDeId: "pub-1" },
    };
    const originalById = new Map<string, PublicationOriginalRow>([
      ["pub-1", { id: "pub-1", contenu: "Le contenu original.", auteurId: "createur-1" }],
    ]);
    const pseudoById = new Map<string, string | null>([
      ["createur-1", "sergio"],
      ["createur-2", "marie"],
    ]);
    const labelById = new Map<string, string>([
      ["fan-1", "Fan Un"],
      ["createur-1", "Sergio Créateur"],
      ["createur-2", "Marie Créatrice"],
    ]);

    const result = buildPublicationSignalee(
      row,
      originalById,
      pseudoById,
      labelById,
      DELETED_USER_LABEL,
      AUTOMATIQUE_LABEL,
    );

    // The permalink must point at the REPOST (what was actually reported
    // and what the reporter actually saw), not the original.
    expect(result.id).toBe("repost-1");
    expect(result.pseudo).toBe("marie");
    // Never blank -- resolved from the original, not the repost's own
    // (always-null) contenu.
    expect(result.contenu).toBe("Le contenu original.");
    expect(result.contenu).not.toBe("");
    expect(result.isRepost).toBe(true);
    expect(result.repostOriginalLabel).toBe("@sergio");
    expect(result.auteurLabel).toBe("Marie Créatrice");
  });

  it("falls back to a display-name label when the original's author has no pseudo", () => {
    const row: PublicationSignaleeRow = {
      reportId: "report-3",
      type: "signalement",
      raison: null,
      createdAt: "2026-01-03T00:00:00Z",
      reporterId: "fan-1",
      reportedUserId: "createur-2",
      publication: { id: "repost-2", contenu: null, repostDeId: "pub-2" },
    };
    const originalById = new Map<string, PublicationOriginalRow>([
      ["pub-2", { id: "pub-2", contenu: "Autre contenu.", auteurId: "createur-3" }],
    ]);
    const pseudoById = new Map<string, string | null>([["createur-3", null]]);
    const labelById = new Map<string, string>([["createur-3", "Créateur Sans Pseudo"]]);

    const result = buildPublicationSignalee(
      row,
      originalById,
      pseudoById,
      labelById,
      DELETED_USER_LABEL,
      AUTOMATIQUE_LABEL,
    );

    expect(result.repostOriginalLabel).toBe("Créateur Sans Pseudo");
  });

  it("falls back to the deleted-user label when the original can't be found", () => {
    const row: PublicationSignaleeRow = {
      reportId: "report-4",
      type: "signalement",
      raison: null,
      createdAt: "2026-01-04T00:00:00Z",
      reporterId: "fan-1",
      reportedUserId: "createur-2",
      publication: { id: "repost-3", contenu: null, repostDeId: "pub-missing" },
    };

    const result = buildPublicationSignalee(
      row,
      new Map(),
      new Map(),
      new Map(),
      DELETED_USER_LABEL,
      AUTOMATIQUE_LABEL,
    );

    expect(result.contenu).toBe("");
    expect(result.isRepost).toBe(true);
    expect(result.repostOriginalLabel).toBe(DELETED_USER_LABEL);
  });

  it("has no permalink pseudo when the reported author never set one", () => {
    const row: PublicationSignaleeRow = {
      reportId: "report-5",
      type: "signalement",
      raison: null,
      createdAt: "2026-01-05T00:00:00Z",
      reporterId: "fan-1",
      reportedUserId: "createur-4",
      publication: { id: "pub-5", contenu: "Contenu.", repostDeId: null },
    };
    const pseudoById = new Map<string, string | null>([["createur-4", null]]);

    const result = buildPublicationSignalee(
      row,
      new Map(),
      pseudoById,
      new Map(),
      DELETED_USER_LABEL,
      AUTOMATIQUE_LABEL,
    );

    expect(result.pseudo).toBeNull();
  });

  // Automatic moderation (migration 0054) -- signaler_publication_automatique()
  // always inserts with reporter_id null and type='signalement_automatique'.
  describe("automatic signalements", () => {
    it("uses the automatique label as reporterLabel and sets isAutomatique, never falling back to deletedUserLabel", () => {
      const row: PublicationSignaleeRow = {
        reportId: "report-6",
        type: "signalement_automatique",
        raison: "ton potentiellement agressif",
        createdAt: "2026-01-06T00:00:00Z",
        reporterId: null,
        reportedUserId: "createur-1",
        publication: { id: "pub-6", contenu: "Contenu ambigu.", repostDeId: null },
      };
      const labelById = new Map<string, string>([["createur-1", "Sergio Créateur"]]);

      const result = buildPublicationSignalee(
        row,
        new Map(),
        new Map(),
        labelById,
        DELETED_USER_LABEL,
        AUTOMATIQUE_LABEL,
      );

      expect(result.isAutomatique).toBe(true);
      expect(result.reporterLabel).toBe(AUTOMATIQUE_LABEL);
      expect(result.reporterLabel).not.toBe(DELETED_USER_LABEL);
      expect(result.raison).toBe("ton potentiellement agressif");
      expect(result.auteurLabel).toBe("Sergio Créateur");
    });

    it("is false for a real, non-automatic signalement even when the reporter's own label happens to be missing", () => {
      const row: PublicationSignaleeRow = {
        reportId: "report-7",
        type: "signalement",
        raison: "spam",
        createdAt: "2026-01-07T00:00:00Z",
        reporterId: "fan-deleted",
        reportedUserId: "createur-1",
        publication: { id: "pub-7", contenu: "Contenu.", repostDeId: null },
      };

      const result = buildPublicationSignalee(
        row,
        new Map(),
        new Map(),
        new Map(),
        DELETED_USER_LABEL,
        AUTOMATIQUE_LABEL,
      );

      expect(result.isAutomatique).toBe(false);
      expect(result.reporterLabel).toBe(DELETED_USER_LABEL);
    });
  });
});
