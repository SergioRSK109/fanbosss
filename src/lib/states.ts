import statesByCountry from "@/lib/data/states.json";

export interface State {
  code: string;
  name: string;
}

// Derived from the "Countries States Cities Database" project
// (https://github.com/dr5hn/countries-states-cities-database), licensed
// under the Open Database License (ODbL) -- attribution required, see
// CREDITS.md. Only states/provinces for the countries already listed in
// lib/countries.ts are kept (the upstream dataset also has cities and
// postcodes for ~250 countries, which we don't need and would make this
// file orders of magnitude larger for no benefit -- signup's ville field
// is free text, see SignupForm.tsx). Generated once, not fetched at
// runtime, so signup has no third-party dependency at request time.
const STATES_BY_COUNTRY: Record<string, State[]> = statesByCountry;

export function getStatesForCountry(countryCode: string): State[] {
  return STATES_BY_COUNTRY[countryCode] ?? [];
}
