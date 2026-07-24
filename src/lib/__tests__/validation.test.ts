import { describe, expect, it } from "vitest";
import {
  creerOffreSchema,
  pseudoLockedUntil,
  PSEUDO_COOLDOWN_MS,
  WHATSAPP_PRIX_MINIMUM,
} from "@/lib/validation";

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
});
