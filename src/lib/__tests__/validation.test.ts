import { describe, expect, it } from "vitest";
import { creerOffreSchema } from "@/lib/validation";

describe("creerOffreSchema", () => {
  it("accepts a whatsapp offer at exactly the $500 floor", () => {
    expect(
      creerOffreSchema.safeParse({ type: "whatsapp", prix: 500 }).success,
    ).toBe(true);
  });

  it("rejects a whatsapp offer below $500", () => {
    expect(
      creerOffreSchema.safeParse({ type: "whatsapp", prix: 499.99 }).success,
    ).toBe(false);
  });

  it("allows a cheap video offer", () => {
    expect(
      creerOffreSchema.safeParse({ type: "video", prix: 10 }).success,
    ).toBe(true);
  });
});
