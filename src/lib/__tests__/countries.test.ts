import { describe, expect, it } from "vitest";
import {
  clampHighlightedIndex,
  COUNTRIES,
  filterCountriesByQuery,
  getCountryName,
} from "@/lib/countries";

describe("COUNTRIES", () => {
  it("has no duplicate ISO codes", () => {
    const codes = COUNTRIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("covers roughly the ~195 countries of the world (193 UN members + Vatican City), plus the 'Autre' fallback", () => {
    // 194 real ISO 3166-1 sovereign states + the deliberate "Autre"/"Other"
    // fallback entry (kept for src/lib/livraison.ts's checkDeliveryZone(),
    // whose own handling of that value is explicitly out of scope here).
    expect(COUNTRIES.length).toBe(195);
  });

  it("keeps the 'Autre' fallback last, with no dial code and no provinces", () => {
    const last = COUNTRIES[COUNTRIES.length - 1];
    expect(last.code).toBe("OTHER");
    expect(last.dial).toBe("");
    expect(last.provinces ?? []).toEqual([]);
  });

  it("gives every entry a non-empty French and English name", () => {
    for (const country of COUNTRIES) {
      expect(country.name.trim().length).toBeGreaterThan(0);
      expect(country.nameEn.trim().length).toBeGreaterThan(0);
    }
  });

  it("gives every real country (all but 'Autre') a dial code", () => {
    for (const country of COUNTRIES) {
      if (country.code === "OTHER") continue;
      expect(country.dial.startsWith("+")).toBe(true);
    }
  });

  // A verified sample: RD Congo plus its 9 neighbouring countries, and 20
  // more picked at random -- every one of these dial codes was
  // cross-checked against an independent web search (not just the
  // generation source itself) before this list was trusted. See
  // CLAUDE.md's own "src/lib/countries.ts" section for the full account,
  // including the handful of entries corrected after that check.
  it("matches an independently-verified sample of dial codes (RDC + its 9 neighbours)", () => {
    const expected: Record<string, string> = {
      CD: "+243", // RD Congo
      AO: "+244", // Angola
      ZM: "+260", // Zambie
      TZ: "+255", // Tanzanie
      BI: "+257", // Burundi
      RW: "+250", // Rwanda
      UG: "+256", // Ouganda
      SS: "+211", // Soudan du Sud
      CF: "+236", // République centrafricaine
      CG: "+242", // Congo-Brazzaville
    };
    for (const [code, dial] of Object.entries(expected)) {
      const country = COUNTRIES.find((c) => c.code === code);
      expect(country?.dial).toBe(dial);
    }
  });

  it("matches an independently-verified random sample of 20 more countries", () => {
    const expected: Record<string, string> = {
      SI: "+386", // Slovénie
      BN: "+673", // Brunei
      VE: "+58", // Venezuela
      GN: "+224", // Guinée
      FR: "+33", // France
      EE: "+372", // Estonie
      CL: "+56", // Chili
      VU: "+678", // Vanuatu
      BW: "+267", // Botswana
      TJ: "+992", // Tadjikistan
      PE: "+51", // Pérou
      BY: "+375", // Biélorussie
      SM: "+378", // Saint-Marin
      MY: "+60", // Malaisie
      SA: "+966", // Arabie Saoudite
      AG: "+1268", // Antigua-et-Barbuda
      MM: "+95", // Birmanie
      ER: "+291", // Érythrée
      ET: "+251", // Éthiopie
      AO: "+244", // Angola (also part of the neighbour sample above)
    };
    for (const [code, dial] of Object.entries(expected)) {
      const country = COUNTRIES.find((c) => c.code === code);
      expect(country?.dial).toBe(dial);
    }
  });

  it("gives RD Congo exactly its 26 provinces, alphabetically ordered and including the capital", () => {
    const cd = COUNTRIES.find((c) => c.code === "CD");
    expect(cd?.provinces).toBeDefined();
    expect(cd?.provinces).toHaveLength(26);
    expect(cd?.provinces).toContain("Kinshasa");
    expect(cd?.provinces).toEqual(
      [...(cd?.provinces ?? [])].sort((a, b) => a.localeCompare(b, "fr")),
    );
  });

  it("leaves every non-RDC country without a province list in this lot", () => {
    const withProvinces = COUNTRIES.filter(
      (c) => (c.provinces?.length ?? 0) > 0,
    ).map((c) => c.code);
    expect(withProvinces).toEqual(["CD"]);
  });
});

describe("getCountryName", () => {
  const cd = COUNTRIES.find((c) => c.code === "CD")!;

  it("returns the French name for a French/default locale", () => {
    expect(getCountryName(cd, "fr")).toBe("RD Congo");
  });

  it("returns the English name for an English locale, including locale prefixes like 'en-US'", () => {
    expect(getCountryName(cd, "en")).toBe("DR Congo");
    expect(getCountryName(cd, "en-US")).toBe("DR Congo");
  });
});

describe("filterCountriesByQuery", () => {
  it("returns every country for an empty or whitespace-only query", () => {
    expect(filterCountriesByQuery(COUNTRIES, "", "fr")).toEqual(COUNTRIES);
    expect(filterCountriesByQuery(COUNTRIES, "   ", "fr")).toEqual(COUNTRIES);
  });

  it("matches by prefix on any word of the name, not just the start of the whole string", () => {
    const results = filterCountriesByQuery(COUNTRIES, "CO", "fr").map((c) => c.code);
    // "RD Congo" matches on its second word ("Congo"), not the start of
    // its own name -- this is the whole point of the word-token matching,
    // per the brief's own worked example.
    expect(results).toEqual(
      expect.arrayContaining(["CG", "CD", "CO", "KM", "CI"]),
    );
  });

  it("is case-insensitive", () => {
    const upper = filterCountriesByQuery(COUNTRIES, "FRA", "fr").map((c) => c.code);
    const lower = filterCountriesByQuery(COUNTRIES, "fra", "fr").map((c) => c.code);
    expect(upper).toEqual(lower);
    expect(upper).toContain("FR");
  });

  it("is accent-insensitive: 'Cote' finds 'Côte d'Ivoire'", () => {
    const results = filterCountriesByQuery(COUNTRIES, "Cote", "fr").map((c) => c.code);
    expect(results).toContain("CI");
  });

  it("filters against the English name when the locale is English", () => {
    // "Ivory" only appears in the English name, never the French one.
    const fr = filterCountriesByQuery(COUNTRIES, "Ivory", "fr");
    const en = filterCountriesByQuery(COUNTRIES, "Ivory", "en");
    expect(fr).toHaveLength(0);
    expect(en.map((c) => c.code)).toContain("CI");
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterCountriesByQuery(COUNTRIES, "zzzznotacountry", "fr")).toEqual([]);
  });

  it("matches a full multi-word country name, not just a single word of it", () => {
    // Regression test: the query itself must be tokenized the same way a
    // country's name is -- a query longer than any single name word (e.g.
    // typing the whole "RD Congo") would otherwise never match anything,
    // since no single word of the name is as long as the whole query.
    const rdCongo = filterCountriesByQuery(COUNTRIES, "RD Congo", "fr").map((c) => c.code);
    expect(rdCongo).toEqual(["CD"]);

    const ci = filterCountriesByQuery(COUNTRIES, "Côte d'Ivoire", "fr").map((c) => c.code);
    expect(ci).toEqual(["CI"]);
  });

  it("matches a full multi-word country name typed without accents", () => {
    const results = filterCountriesByQuery(COUNTRIES, "Cote d'Ivoire", "fr").map((c) => c.code);
    expect(results).toEqual(["CI"]);
  });

  it("requires every query word to match, so an unrelated second word excludes a country", () => {
    const results = filterCountriesByQuery(COUNTRIES, "RD Brazzaville", "fr");
    expect(results).toEqual([]);
  });
});

describe("clampHighlightedIndex", () => {
  it("moves forward/backward within bounds", () => {
    expect(clampHighlightedIndex(2, 1, 5)).toBe(3);
    expect(clampHighlightedIndex(2, -1, 5)).toBe(1);
  });

  it("never goes below 0", () => {
    expect(clampHighlightedIndex(0, -1, 5)).toBe(0);
  });

  it("never goes past the last index", () => {
    expect(clampHighlightedIndex(4, 1, 5)).toBe(4);
  });

  it("stays at 0 when there are no results at all", () => {
    expect(clampHighlightedIndex(0, 1, 0)).toBe(0);
    expect(clampHighlightedIndex(3, -1, 0)).toBe(0);
  });
});
