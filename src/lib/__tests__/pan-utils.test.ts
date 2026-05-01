import { describe, it, expect } from "vitest";
import { clampPan } from "@/lib/pan-utils";

describe("clampPan", () => {
  it("clamps to {0,0} when content fits inside container (no overflow)", () => {
    const result = clampPan(
      { x: 50, y: 50 },
      { w: 400, h: 400 },
      { w: 100, h: 100 },
      1,
    );
    expect(result).toEqual({ x: 0, y: 0 });
  });

  it("allows pan within ±D/2 on symmetric overflow", () => {
    // container 200x200, content 300x300, zoom 1 → overflow 100 → limit ±50
    expect(
      clampPan({ x: 999, y: 999 }, { w: 200, h: 200 }, { w: 300, h: 300 }, 1),
    ).toEqual({ x: 50, y: 50 });
    expect(
      clampPan({ x: -999, y: -999 }, { w: 200, h: 200 }, { w: 300, h: 300 }, 1),
    ).toEqual({ x: -50, y: -50 });
    // Within limits → unchanged
    expect(
      clampPan({ x: 30, y: -20 }, { w: 200, h: 200 }, { w: 300, h: 300 }, 1),
    ).toEqual({ x: 30, y: -20 });
  });

  it("multiplies content dims by zoom: 200×200 container, 100×100 natural, zoom 4 → limit ±100", () => {
    const result = clampPan(
      { x: 999, y: 999 },
      { w: 200, h: 200 },
      { w: 100, h: 100 },
      4,
    );
    expect(result).toEqual({ x: 100, y: 100 });
  });

  it("zero-zoom: content has zero size → clamps to {0,0}", () => {
    const result = clampPan(
      { x: 999, y: -999 },
      { w: 200, h: 200 },
      { w: 100, h: 100 },
      0,
    );
    expect(result).toEqual({ x: 0, y: 0 });
  });
});
