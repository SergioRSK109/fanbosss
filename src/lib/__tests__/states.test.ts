import { describe, expect, it } from "vitest";
import { COUNTRIES } from "@/lib/countries";
import { getStatesForCountry } from "@/lib/states";

describe("getStatesForCountry", () => {
  it("returns RDC's provinces, including the capital", () => {
    const states = getStatesForCountry("CD");
    expect(states.length).toBeGreaterThan(0);
    expect(states.some((s) => s.name === "Kinshasa")).toBe(true);
  });

  it("returns an empty array for an unknown/unlisted country code", () => {
    expect(getStatesForCountry("OTHER")).toEqual([]);
    expect(getStatesForCountry("ZZ")).toEqual([]);
  });

  it("has no duplicate state codes within a single country (dropdown option keys must be unique)", () => {
    for (const country of COUNTRIES) {
      const states = getStatesForCountry(country.code);
      const codes = states.map((s) => s.code);
      expect(new Set(codes).size).toBe(codes.length);
    }
  });

  // Every real country in lib/countries.ts is expected to have at least
  // one entry in the filtered ODbL dataset -- if this ever fails after
  // adding a new country there, the states dataset (src/lib/data/states.json)
  // needs regenerating for it too, or the province field will silently
  // never appear for that country's signups.
  it("has at least one province for every real country in COUNTRIES", () => {
    const missing = COUNTRIES.filter(
      (c) => c.code !== "OTHER" && getStatesForCountry(c.code).length === 0,
    );
    expect(missing).toEqual([]);
  });
});
