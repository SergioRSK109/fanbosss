import { describe, expect, it } from "vitest";
import { COVER_EXPORT_HEIGHT, COVER_EXPORT_WIDTH, computeCoverDrawGeometry } from "@/lib/coverCrop";

describe("computeCoverDrawGeometry", () => {
  it("covers the target rectangle exactly for a matching-aspect-ratio source", () => {
    // Exactly 3:1, same as the export target -- should scale with no
    // leftover offset on either axis.
    const { drawWidth, drawHeight, offsetX, offsetY } = computeCoverDrawGeometry(2400, 800);
    expect(drawWidth).toBeCloseTo(COVER_EXPORT_WIDTH);
    expect(drawHeight).toBeCloseTo(COVER_EXPORT_HEIGHT);
    expect(offsetX).toBeCloseTo(0);
    expect(offsetY).toBeCloseTo(0);
  });

  it("centers a portrait source, cropping top and bottom", () => {
    // Tall/narrow portrait (aspect 0.8) is much narrower than the 3:1
    // target -- scaling to cover the target WIDTH exactly makes the
    // height massively overflow, so it's the vertical axis that gets
    // cropped (centered with a negative offsetY), not the sides.
    const { drawWidth, drawHeight, offsetX, offsetY } = computeCoverDrawGeometry(800, 1000);
    expect(drawWidth).toBeCloseTo(COVER_EXPORT_WIDTH);
    expect(drawHeight).toBeGreaterThan(COVER_EXPORT_HEIGHT);
    expect(offsetX).toBeCloseTo(0);
    expect(offsetY).toBeCloseTo((COVER_EXPORT_HEIGHT - drawHeight) / 2);
    expect(offsetY).toBeLessThan(0);
  });

  it("centers a very wide source, cropping the sides", () => {
    // Ultra-wide (aspect 8) is much wider than the 3:1 target -- scaling
    // to cover the target HEIGHT exactly makes the width overflow, so
    // the sides get cropped (centered with a negative offsetX).
    const { drawWidth, drawHeight, offsetX, offsetY } = computeCoverDrawGeometry(4000, 500);
    expect(drawHeight).toBeCloseTo(COVER_EXPORT_HEIGHT);
    expect(drawWidth).toBeGreaterThan(COVER_EXPORT_WIDTH);
    expect(offsetY).toBeCloseTo(0);
    expect(offsetX).toBeCloseTo((COVER_EXPORT_WIDTH - drawWidth) / 2);
    expect(offsetX).toBeLessThan(0);
  });

  it("always fully covers the target rectangle regardless of source aspect ratio", () => {
    for (const [w, h] of [
      [4000, 3000],
      [3000, 4000],
      [1000, 1000],
      [5000, 800],
      [200, 200],
    ]) {
      const { drawWidth, drawHeight } = computeCoverDrawGeometry(w, h);
      expect(drawWidth).toBeGreaterThanOrEqual(COVER_EXPORT_WIDTH - 0.01);
      expect(drawHeight).toBeGreaterThanOrEqual(COVER_EXPORT_HEIGHT - 0.01);
    }
  });

  it("scales up a smaller-than-target source rather than leaving gaps", () => {
    const { drawWidth, drawHeight } = computeCoverDrawGeometry(300, 100);
    expect(drawWidth).toBeCloseTo(COVER_EXPORT_WIDTH);
    expect(drawHeight).toBeCloseTo(COVER_EXPORT_HEIGHT);
  });
});
