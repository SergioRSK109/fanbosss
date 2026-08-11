import { describe, expect, it } from "vitest";
import {
  computeDateExpirationAcces,
  CONTENU_DEBLOQUE_DUREE_ACCES_JOURS_DEFAUT,
  isAccesExpire,
} from "@/lib/contenuDebloque";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("computeDateExpirationAcces", () => {
  it("defaults to 30 days when duree_acces_jours is omitted", () => {
    const createdAt = "2026-01-01T00:00:00.000Z";
    const expiration = computeDateExpirationAcces(createdAt);
    expect(expiration.toISOString()).toBe("2026-01-31T00:00:00.000Z");
    expect(CONTENU_DEBLOQUE_DUREE_ACCES_JOURS_DEFAUT).toBe(30);
  });

  it("defaults to 30 days for null/undefined/non-positive/non-finite values", () => {
    const createdAt = "2026-01-01T00:00:00.000Z";
    const expected = computeDateExpirationAcces(createdAt, 30).toISOString();
    expect(computeDateExpirationAcces(createdAt, null).toISOString()).toBe(expected);
    expect(computeDateExpirationAcces(createdAt, undefined).toISOString()).toBe(expected);
    expect(computeDateExpirationAcces(createdAt, 0).toISOString()).toBe(expected);
    expect(computeDateExpirationAcces(createdAt, -5).toISOString()).toBe(expected);
    expect(computeDateExpirationAcces(createdAt, Number.NaN).toISOString()).toBe(expected);
  });

  it("respects a créateur-configured custom duration", () => {
    const createdAt = "2026-01-01T00:00:00.000Z";
    const expiration = computeDateExpirationAcces(createdAt, 7);
    expect(expiration.toISOString()).toBe("2026-01-08T00:00:00.000Z");
  });
});

describe("isAccesExpire", () => {
  it("grants access within the default 30-day window", () => {
    const createdAt = new Date(Date.now() - 15 * DAY_MS).toISOString();
    expect(isAccesExpire(createdAt)).toBe(false);
  });

  it("rejects access once the default 30-day window has passed", () => {
    const createdAt = new Date(Date.now() - 31 * DAY_MS).toISOString();
    expect(isAccesExpire(createdAt)).toBe(true);
  });

  it("respects a shorter custom duration (7 days): granted on day 5, expired on day 8", () => {
    const createdAtDay5 = new Date(Date.now() - 5 * DAY_MS).toISOString();
    const createdAtDay8 = new Date(Date.now() - 8 * DAY_MS).toISOString();
    expect(isAccesExpire(createdAtDay5, 7)).toBe(false);
    expect(isAccesExpire(createdAtDay8, 7)).toBe(true);
  });

  it("is inclusive at the exact expiry instant", () => {
    const createdAt = "2026-01-01T00:00:00.000Z";
    const exactlyAtExpiry = new Date(createdAt).getTime() + 30 * DAY_MS;
    expect(isAccesExpire(createdAt, null, new Date(exactlyAtExpiry))).toBe(true);
    expect(isAccesExpire(createdAt, null, new Date(exactlyAtExpiry - 1))).toBe(false);
  });
});
