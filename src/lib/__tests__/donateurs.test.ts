import { describe, expect, it } from "vitest";
import { iconForPalierDonateur, PALIERS_DONATEUR } from "@/lib/donateurs";

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
