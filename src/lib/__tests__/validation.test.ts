import { describe, expect, it } from "vitest";
import { creerOffreSchema, WHATSAPP_PRIX_MINIMUM } from "@/lib/validation";

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
});
