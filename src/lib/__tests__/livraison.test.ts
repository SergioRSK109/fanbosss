import { describe, expect, it } from "vitest";
import { checkDeliveryZone } from "@/lib/livraison";

describe("checkDeliveryZone", () => {
  it("never blocks when portee is null (not configured yet)", () => {
    expect(checkDeliveryZone(null, "Kinshasa", "Kongo Central")).toEqual({
      blocked: false,
      missingFanData: false,
    });
    expect(checkDeliveryZone(null, null, null)).toEqual({ blocked: false, missingFanData: false });
  });

  it("never blocks when portee is aucune_restriction", () => {
    expect(checkDeliveryZone("aucune_restriction", "Kinshasa", "Kongo Central")).toEqual({
      blocked: false,
      missingFanData: false,
    });
  });

  describe("portee = province", () => {
    it("blocks when the fan's province doesn't match the créateur's", () => {
      expect(checkDeliveryZone("province", "Kongo Central", "Kinshasa")).toEqual({
        blocked: true,
        missingFanData: false,
      });
    });

    it("does not block when the fan's province matches the créateur's", () => {
      expect(checkDeliveryZone("province", "Kinshasa", "Kinshasa")).toEqual({
        blocked: false,
        missingFanData: false,
      });
    });

    it("is case- and whitespace-insensitive", () => {
      expect(checkDeliveryZone("province", "  kinshasa  ", "KINSHASA")).toEqual({
        blocked: false,
        missingFanData: false,
      });
    });

    it("never blocks on missing fan data, and flags it as a soft warning instead", () => {
      expect(checkDeliveryZone("province", null, "Kinshasa")).toEqual({
        blocked: false,
        missingFanData: true,
      });
      expect(checkDeliveryZone("province", "   ", "Kinshasa")).toEqual({
        blocked: false,
        missingFanData: true,
      });
      expect(checkDeliveryZone("province", undefined, "Kinshasa")).toEqual({
        blocked: false,
        missingFanData: true,
      });
    });

    it("never blocks when the créateur's own province is missing either", () => {
      expect(checkDeliveryZone("province", "Kinshasa", null)).toEqual({
        blocked: false,
        missingFanData: false,
      });
    });
  });

  describe("portee = pays", () => {
    it("blocks when the fan's country doesn't match the créateur's", () => {
      expect(checkDeliveryZone("pays", "Belgique", "RDC")).toEqual({
        blocked: true,
        missingFanData: false,
      });
    });

    it("does not block when the fan's country matches the créateur's", () => {
      expect(checkDeliveryZone("pays", "RDC", "RDC")).toEqual({
        blocked: false,
        missingFanData: false,
      });
    });

    it("is case- and whitespace-insensitive", () => {
      expect(checkDeliveryZone("pays", " rdc ", "RDC")).toEqual({
        blocked: false,
        missingFanData: false,
      });
    });

    it("never blocks on missing fan data, and flags it as a soft warning instead", () => {
      expect(checkDeliveryZone("pays", null, "RDC")).toEqual({ blocked: false, missingFanData: true });
    });

    it("never blocks when the créateur's own country is missing either", () => {
      expect(checkDeliveryZone("pays", "RDC", null)).toEqual({
        blocked: false,
        missingFanData: false,
      });
    });
  });
});
