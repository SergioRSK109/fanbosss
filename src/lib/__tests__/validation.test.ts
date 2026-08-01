import { describe, expect, it } from "vitest";
import {
  creerOffreSchema,
  isAtLeast18,
  minBirthDateForSignup,
  publierMessageSchema,
  pseudoLockedUntil,
  PSEUDO_COOLDOWN_MS,
  WHATSAPP_PRIX_MINIMUM,
} from "@/lib/validation";

describe("minBirthDateForSignup / isAtLeast18", () => {
  // Fixed reference date so these assertions don't depend on when the
  // test suite happens to run.
  const reference = new Date("2026-07-25T12:00:00.000Z");

  it("computes the cutoff as exactly 18 years before the reference date", () => {
    expect(minBirthDateForSignup(reference)).toBe("2008-07-25");
  });

  it("accepts someone born exactly 18 years ago today (boundary)", () => {
    expect(isAtLeast18("2008-07-25", reference)).toBe(true);
  });

  it("rejects someone one day short of 18 years old (boundary)", () => {
    expect(isAtLeast18("2008-07-26", reference)).toBe(false);
  });

  it("accepts someone older than 18", () => {
    expect(isAtLeast18("2000-01-01", reference)).toBe(true);
  });

  it("rejects someone clearly under 18", () => {
    expect(isAtLeast18("2015-01-01", reference)).toBe(false);
  });

  it("rejects an empty date (nothing selected yet)", () => {
    expect(isAtLeast18("", reference)).toBe(false);
  });
});

describe("pseudoLockedUntil", () => {
  it("is not locked when the pseudo was never changed", () => {
    expect(pseudoLockedUntil(null)).toBeNull();
  });

  it("is locked just after a change, with the unlock date 30 days out", () => {
    const changedAt = new Date().toISOString();
    const locked = pseudoLockedUntil(changedAt);
    expect(locked).not.toBeNull();
    expect(new Date(locked!).getTime()).toBeCloseTo(
      new Date(changedAt).getTime() + PSEUDO_COOLDOWN_MS,
      -2,
    );
  });

  it("is unlocked once 30 days have fully elapsed", () => {
    const changedAt = new Date(Date.now() - PSEUDO_COOLDOWN_MS - 1000).toISOString();
    expect(pseudoLockedUntil(changedAt)).toBeNull();
  });

  it("is still locked one second before the 30-day mark", () => {
    const changedAt = new Date(Date.now() - PSEUDO_COOLDOWN_MS + 1000).toISOString();
    expect(pseudoLockedUntil(changedAt)).not.toBeNull();
  });
});

describe("creerOffreSchema", () => {
  it("accepts a whatsapp offer at exactly the $20 floor", () => {
    expect(WHATSAPP_PRIX_MINIMUM).toBe(20);
    expect(
      creerOffreSchema.safeParse({ type: "whatsapp", prix: 20 }).success,
    ).toBe(true);
  });

  it("rejects a whatsapp offer below $20", () => {
    expect(
      creerOffreSchema.safeParse({ type: "whatsapp", prix: 19.99 }).success,
    ).toBe(false);
  });

  it("allows a cheap video offer", () => {
    expect(
      creerOffreSchema.safeParse({ type: "video", prix: 10 }).success,
    ).toBe(true);
  });

  it("rejects a video/shoutout/contenu_debloque/evenement_live offer with no price", () => {
    for (const type of [
      "video",
      "shoutout",
      "contenu_debloque",
      "evenement_live",
    ] as const) {
      expect(creerOffreSchema.safeParse({ type }).success).toBe(false);
    }
  });

  it("allows a don offer with no price at all (the fan picks the amount)", () => {
    expect(creerOffreSchema.safeParse({ type: "don" }).success).toBe(true);
  });

  it("accepts the 4 new offer types with a price", () => {
    for (const type of ["shoutout", "contenu_debloque", "evenement_live"] as const) {
      expect(creerOffreSchema.safeParse({ type, prix: 5 }).success).toBe(true);
    }
  });

  it("accepts a video offer with a libelle", () => {
    const result = creerOffreSchema.safeParse({
      type: "video",
      prix: 15,
      libelle: "Danse",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.libelle).toBe("Danse");
    }
  });

  it("rejects an all-whitespace libelle (trimmed to empty)", () => {
    expect(
      creerOffreSchema.safeParse({ type: "video", prix: 15, libelle: "   " })
        .success,
    ).toBe(false);
  });

  it("allows a video offer with no libelle at all (still optional)", () => {
    expect(
      creerOffreSchema.safeParse({ type: "video", prix: 15 }).success,
    ).toBe(true);
  });

  // Regression: actif used to be entirely absent from this schema, so
  // POST /api/offres silently dropped it and the désactiver/réactiver
  // toggle never actually took effect. Assert it survives parsing in both
  // directions, not just that the schema accepts the request.
  it("keeps actif=false through parsing (désactiver)", () => {
    const result = creerOffreSchema.safeParse({
      type: "don",
      actif: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.actif).toBe(false);
    }
  });

  it("keeps actif=true through parsing (réactiver)", () => {
    const result = creerOffreSchema.safeParse({
      type: "whatsapp",
      prix: 20,
      actif: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.actif).toBe(true);
    }
  });

  describe("campagne", () => {
    const valid = {
      type: "campagne" as const,
      libelle: "Toit pour l'église",
      config: { description: "Réparer le toit", objectif: 500 },
    };

    it("accepts a well-formed campagne with no price at all (free-amount, like don)", () => {
      expect(creerOffreSchema.safeParse(valid).success).toBe(true);
    });

    it("accepts an optional date_fin in YYYY-MM-DD format", () => {
      expect(
        creerOffreSchema.safeParse({
          ...valid,
          config: { ...valid.config, date_fin: "2026-12-31" },
        }).success,
      ).toBe(true);
    });

    it("accepts a null date_fin explicitly", () => {
      expect(
        creerOffreSchema.safeParse({
          ...valid,
          config: { ...valid.config, date_fin: null },
        }).success,
      ).toBe(true);
    });

    it("rejects a malformed date_fin", () => {
      expect(
        creerOffreSchema.safeParse({
          ...valid,
          config: { ...valid.config, date_fin: "31/12/2026" },
        }).success,
      ).toBe(false);
    });

    it("rejects a campagne with no libelle (title is required)", () => {
      expect(
        creerOffreSchema.safeParse({ type: "campagne", config: valid.config }).success,
      ).toBe(false);
    });

    it("rejects a campagne with no objectif", () => {
      expect(
        creerOffreSchema.safeParse({
          type: "campagne",
          libelle: valid.libelle,
          config: { description: "x" },
        }).success,
      ).toBe(false);
    });

    it("rejects a campagne with a zero or negative objectif", () => {
      for (const objectif of [0, -10]) {
        expect(
          creerOffreSchema.safeParse({
            ...valid,
            config: { ...valid.config, objectif },
          }).success,
        ).toBe(false);
      }
    });

    it("rejects a campagne with no description", () => {
      expect(
        creerOffreSchema.safeParse({
          type: "campagne",
          libelle: valid.libelle,
          config: { objectif: 500 },
        }).success,
      ).toBe(false);
    });
  });
});

describe("publierMessageSchema", () => {
  it("accepts a plain text-only publication", () => {
    expect(publierMessageSchema.safeParse({ contenu: "Quoi de neuf ?" }).success).toBe(true);
  });

  it("accepts a publication with only an image", () => {
    expect(
      publierMessageSchema.safeParse({ contenu: "photo", image_r2_key: "publications/u1/a.jpg" })
        .success,
    ).toBe(true);
  });

  it("accepts a publication with only a video", () => {
    expect(
      publierMessageSchema.safeParse({ contenu: "vidéo", video_r2_key: "publications/u1/a.mp4" })
        .success,
    ).toBe(true);
  });

  // publications_media_exclusif (migration 0037) is the real DB-level
  // guarantee -- this is just the same "clean 400 instead of a raw
  // Postgres error" every other schema in this file already gives its
  // own mirrored DB constraint.
  it("rejects a publication with both an image and a video", () => {
    expect(
      publierMessageSchema.safeParse({
        contenu: "les deux à la fois",
        image_r2_key: "publications/u1/a.jpg",
        video_r2_key: "publications/u1/a.mp4",
      }).success,
    ).toBe(false);
  });
});
