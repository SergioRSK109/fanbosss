import { describe, expect, it } from "vitest";
import { clampOffsetFrac, computeDrawGeometry } from "@/lib/imageCrop";

describe("computeDrawGeometry", () => {
  it("scales the shorter side to exactly cover the square at zoom=1", () => {
    // Landscape 4000x3000 -- shorter side (3000) must cover a 800 square.
    const { drawWidth, drawHeight } = computeDrawGeometry(4000, 3000, 800, 1, 0);
    expect(drawHeight).toBeCloseTo(800);
    expect(drawWidth).toBeCloseTo((4000 / 3000) * 800);
  });

  it("scales up proportionally with zoom", () => {
    const base = computeDrawGeometry(4000, 3000, 800, 1, 0);
    const zoomed = computeDrawGeometry(4000, 3000, 800, 2, 0);
    expect(zoomed.drawWidth).toBeCloseTo(base.drawWidth * 2);
    expect(zoomed.drawHeight).toBeCloseTo(base.drawHeight * 2);
  });

  it("swaps effWidth/effHeight at a 90 degree rotation, not at 0", () => {
    const upright = computeDrawGeometry(4000, 3000, 800, 1, 0);
    const rotated = computeDrawGeometry(4000, 3000, 800, 1, 90);
    expect(rotated.effWidth).toBeCloseTo(upright.drawHeight);
    expect(rotated.effHeight).toBeCloseTo(upright.drawWidth);
  });

  it("treats 180 degrees the same as 0 for effective dimensions", () => {
    const at0 = computeDrawGeometry(4000, 3000, 800, 1.5, 0);
    const at180 = computeDrawGeometry(4000, 3000, 800, 1.5, 180);
    expect(at180.effWidth).toBeCloseTo(at0.effWidth);
    expect(at180.effHeight).toBeCloseTo(at0.effHeight);
  });

  it("always covers the square on both axes regardless of source aspect ratio", () => {
    for (const [w, h] of [
      [4000, 3000],
      [3000, 4000],
      [1000, 1000],
      [5000, 800],
    ]) {
      const { effWidth, effHeight } = computeDrawGeometry(w, h, 800, 1, 0);
      expect(effWidth).toBeGreaterThanOrEqual(799.99);
      expect(effHeight).toBeGreaterThanOrEqual(799.99);
    }
  });
});

describe("clampOffsetFrac", () => {
  it("allows no panning when the image is an exact square fit (no slack)", () => {
    const clamped = clampOffsetFrac(0.5, 0.5, 800, 800, 800);
    expect(clamped.offsetXFrac).toBe(0);
    expect(clamped.offsetYFrac).toBe(0);
  });

  it("allows panning up to the available slack on the wider axis", () => {
    // effWidth 1200 vs size 800 -> slack of 400px = 0.25 frac each side.
    const clamped = clampOffsetFrac(1, 0, 1200, 800, 800);
    expect(clamped.offsetXFrac).toBeCloseTo(0.25);
  });

  it("clamps negative offsets symmetrically", () => {
    const clamped = clampOffsetFrac(-1, 0, 1200, 800, 800);
    expect(clamped.offsetXFrac).toBeCloseTo(-0.25);
  });

  it("leaves an in-bounds offset untouched", () => {
    const clamped = clampOffsetFrac(0.1, -0.1, 1200, 1200, 800);
    expect(clamped.offsetXFrac).toBeCloseTo(0.1);
    expect(clamped.offsetYFrac).toBeCloseTo(-0.1);
  });
});
