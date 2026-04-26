import { describe, it, expect } from "vitest";
import { layoutCollisions, type CollisionItem } from "../useCollisionLayout";

const rect = (top: number, left: number, width?: number, height?: number) => ({ top, left, width, height });

describe("layoutCollisions", () => {
  it("1 item → single", () => {
    const items: CollisionItem[] = [{ id: "a", rect: rect(0, 0, 10, 10) }];
    const out = layoutCollisions(items);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "single", id: "a" });
  });

  it("2 well-separated rects → 2 singles", () => {
    const items: CollisionItem[] = [
      { id: "a", rect: rect(0, 0, 10, 10) },
      { id: "b", rect: rect(100, 100, 10, 10) },
    ];
    const out = layoutCollisions(items);
    expect(out).toHaveLength(2);
    expect(out.every((r) => r.kind === "single")).toBe(true);
  });

  it("2 overlapping → stack with offsetIndex 0/1", () => {
    const items: CollisionItem[] = [
      { id: "a", rect: rect(0, 0, 20, 20) },
      { id: "b", rect: rect(5, 5, 20, 20) },
    ];
    const out = layoutCollisions(items);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ kind: "stack", offsetIndex: 0, primaryId: "a", ids: ["a", "b"] });
    expect(out[1]).toMatchObject({ kind: "stack", offsetIndex: 1, primaryId: "a", ids: ["a", "b"] });
  });

  it("3 overlapping → stack with offsetIndex 0/1/2", () => {
    const items: CollisionItem[] = [
      { id: "a", rect: rect(0, 0, 30, 30) },
      { id: "b", rect: rect(5, 5, 30, 30) },
      { id: "c", rect: rect(10, 10, 30, 30) },
    ];
    const out = layoutCollisions(items);
    expect(out).toHaveLength(3);
    expect(out.map((r) => (r as { offsetIndex: number }).offsetIndex)).toEqual([0, 1, 2]);
    expect(out.every((r) => r.kind === "stack")).toBe(true);
  });

  it("4 overlapping → cluster with count=4 + ids sorted", () => {
    const items: CollisionItem[] = [
      { id: "d", rect: rect(0, 0, 40, 40) },
      { id: "b", rect: rect(5, 5, 40, 40) },
      { id: "a", rect: rect(10, 10, 40, 40) },
      { id: "c", rect: rect(15, 15, 40, 40) },
    ];
    const out = layoutCollisions(items);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "cluster", count: 4, ids: ["a", "b", "c", "d"] });
    // bounding box covers (0,0) → (55,55)
    expect(out[0].rect).toMatchObject({ top: 0, left: 0, width: 55, height: 55 });
  });

  it("5 mixed (3 overlap + 2 separate) → 1 stack + 2 singles", () => {
    const items: CollisionItem[] = [
      { id: "a", rect: rect(0, 0, 20, 20) },
      { id: "b", rect: rect(5, 5, 20, 20) },
      { id: "c", rect: rect(10, 10, 20, 20) },
      { id: "d", rect: rect(200, 200, 10, 10) },
      { id: "e", rect: rect(400, 400, 10, 10) },
    ];
    const out = layoutCollisions(items);
    const stacks = out.filter((r) => r.kind === "stack");
    const singles = out.filter((r) => r.kind === "single");
    expect(stacks).toHaveLength(3);
    expect(singles).toHaveLength(2);
    expect(singles.map((r) => (r as { id: string }).id).sort()).toEqual(["d", "e"]);
  });

  it("pin items (no width/height) at same coord cluster correctly", () => {
    const items: CollisionItem[] = [
      { id: "p1", rect: { top: 50, left: 50 } },
      { id: "p2", rect: { top: 51, left: 51 } },
      { id: "p3", rect: { top: 52, left: 52 } },
      { id: "p4", rect: { top: 53, left: 53 } },
    ];
    const out = layoutCollisions(items);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "cluster", count: 4 });
  });

  it("pin items far apart → singles", () => {
    const items: CollisionItem[] = [
      { id: "p1", rect: { top: 0, left: 0 } },
      { id: "p2", rect: { top: 100, left: 100 } },
    ];
    const out = layoutCollisions(items);
    expect(out).toHaveLength(2);
    expect(out.every((r) => r.kind === "single")).toBe(true);
  });

  it("determinism: input in different array order → same output", () => {
    const a: CollisionItem = { id: "a", rect: rect(0, 0, 30, 30) };
    const b: CollisionItem = { id: "b", rect: rect(5, 5, 30, 30) };
    const c: CollisionItem = { id: "c", rect: rect(10, 10, 30, 30) };
    const r1 = layoutCollisions([a, b, c]);
    const r2 = layoutCollisions([c, a, b]);
    const r3 = layoutCollisions([b, c, a]);
    expect(r2).toEqual(r1);
    expect(r3).toEqual(r1);
  });

  it("empty input → empty output", () => {
    expect(layoutCollisions([])).toEqual([]);
  });

  // B6 (iter 9 forward-fix) — non-positive width/height must fall through
  // to the pin fallback. A zero/negative dimension produces a degenerate
  // box that never overlaps; we want such items clustered with neighbours.
  it("rect with width: 0 falls back to pin and clusters with neighbours", () => {
    const items: CollisionItem[] = [
      { id: "a", rect: { top: 50, left: 50, width: 0, height: 0 } },
      { id: "b", rect: { top: 51, left: 51 } },
    ];
    const out = layoutCollisions(items);
    expect(out).toHaveLength(2);
    expect(out.every((r) => r.kind === "stack")).toBe(true);
  });

  it("rect with negative width falls back to pin and clusters with neighbours", () => {
    const items: CollisionItem[] = [
      { id: "a", rect: { top: 50, left: 50, width: -5, height: -5 } },
      { id: "b", rect: { top: 52, left: 52 } },
    ];
    const out = layoutCollisions(items);
    expect(out).toHaveLength(2);
    expect(out.every((r) => r.kind === "stack")).toBe(true);
  });
});
