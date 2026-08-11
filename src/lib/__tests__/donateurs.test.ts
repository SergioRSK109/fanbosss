import { describe, expect, it } from "vitest";
import { iconForPalierDonateur, nomPourPalierDonateur, PALIERS_DONATEUR } from "@/lib/donateurs";

describe("iconForPalierDonateur", () => {
  it("returns a distinct, defined icon for every real palier", () => {
    const icons = PALIERS_DONATEUR.map((palier) => iconForPalierDonateur(palier));
    expect(icons.every((icon) => typeof icon === "string" && icon.length > 0)).toBe(true);
    expect(new Set(icons).size).toBe(PALIERS_DONATEUR.length);
  });

  it("falls back to a defensive default for a value outside the known palier list", () => {
    // Should never happen in practice -- calculer_palier_donateur() only
    // ever returns one of PALIERS_DONATEUR's own values, or NULL (and a
    // NULL row is filtered out of badges_donateur_publics entirely) --
    // this just confirms the lookup doesn't crash on an unexpected input.
    expect(iconForPalierDonateur(7)).toBe("🌱");
  });
});

describe("nomPourPalierDonateur", () => {
  it("returns the correct i18n key for every real palier", () => {
    expect(nomPourPalierDonateur(10)).toBe("bronze");
    expect(nomPourPalierDonateur(50)).toBe("argent");
    expect(nomPourPalierDonateur(100)).toBe("or");
    expect(nomPourPalierDonateur(150)).toBe("platine");
    expect(nomPourPalierDonateur(250)).toBe("emeraude");
    expect(nomPourPalierDonateur(500)).toBe("saphir");
    expect(nomPourPalierDonateur(1000)).toBe("rubis");
    expect(nomPourPalierDonateur(1500)).toBe("diamant");
    expect(nomPourPalierDonateur(3000)).toBe("legende");
  });

  it("returns a distinct key for every real palier", () => {
    const noms = PALIERS_DONATEUR.map((palier) => nomPourPalierDonateur(palier));
    expect(new Set(noms).size).toBe(PALIERS_DONATEUR.length);
  });

  it("falls back to a defensive default for a value outside the known palier list", () => {
    // Same defensive-only reasoning as iconForPalierDonateur()'s own
    // fallback test above.
    expect(nomPourPalierDonateur(7)).toBe("bronze");
  });
});
