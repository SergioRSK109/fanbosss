import { describe, expect, it } from "vitest";
import { resolveDisplayName, sortOffresDonFirst } from "@/lib/profil";

describe("resolveDisplayName", () => {
  it("prefers nom_affichage when set", () => {
    expect(resolveDisplayName("Sergio le Créateur", "sergio_123")).toBe(
      "Sergio le Créateur",
    );
  });

  it("falls back to pseudo when nom_affichage is null", () => {
    expect(resolveDisplayName(null, "sergio_123")).toBe("sergio_123");
  });

  it("falls back to pseudo when nom_affichage is blank", () => {
    expect(resolveDisplayName("   ", "sergio_123")).toBe("sergio_123");
  });

  it("returns null when neither is set", () => {
    expect(resolveDisplayName(null, null)).toBeNull();
  });
});

describe("sortOffresDonFirst", () => {
  it("moves don first even when it was configured after the other offres", () => {
    const offres = [
      { id: "1", type: "video" as const },
      { id: "2", type: "whatsapp" as const },
      { id: "3", type: "don" as const },
    ];

    expect(sortOffresDonFirst(offres).map((o) => o.id)).toEqual(["3", "1", "2"]);
  });

  it("keeps the relative order of every other type unchanged", () => {
    const offres = [
      { id: "1", type: "shoutout" as const },
      { id: "2", type: "video" as const },
      { id: "3", type: "evenement_live" as const },
    ];

    expect(sortOffresDonFirst(offres).map((o) => o.id)).toEqual(["1", "2", "3"]);
  });

  it("is a no-op when there is no don offre at all", () => {
    const offres = [
      { id: "1", type: "whatsapp" as const },
      { id: "2", type: "contenu_debloque" as const },
    ];

    expect(sortOffresDonFirst(offres).map((o) => o.id)).toEqual(["1", "2"]);
  });

  it("does not mutate the input array", () => {
    const offres = [
      { id: "1", type: "video" as const },
      { id: "2", type: "don" as const },
    ];
    const original = [...offres];

    sortOffresDonFirst(offres);

    expect(offres).toEqual(original);
  });
});
