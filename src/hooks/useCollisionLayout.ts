import { useMemo } from "react";

/**
 * useCollisionLayout — group overlapping rect items into render-friendly buckets.
 *
 * Rules: 1 item, no overlap → "single". 2-3 overlapping → "stack" with
 * offsetIndex 0..n-1 (caller renders each marker shifted by `offsetIndex * Δ`).
 * ≥4 overlapping → "cluster" (collapse to a +N badge at the bounding-box
 * top-left). Determinism: items are sorted by `id` before grouping.
 */

export type CollisionItem = {
  id: string;
  rect: { top: number; left: number; width?: number; height?: number };
};

export type CollisionResult =
  | { kind: "single"; id: string; rect: CollisionItem["rect"] }
  | { kind: "stack"; ids: string[]; rect: CollisionItem["rect"]; offsetIndex: number; primaryId: string }
  | { kind: "cluster"; ids: string[]; rect: CollisionItem["rect"]; count: number };

const PIN_FALLBACK = 24;
type Box = { left: number; top: number; right: number; bottom: number };

function toBox(r: CollisionItem["rect"]): Box {
  // B6 (iter 9 forward-fix): treat non-positive width/height as missing.
  // A zero-or-negative dimension produces a degenerate / inside-out box
  // that never overlaps with anything (since `a.left < b.right` fails on
  // `a.left === a.right`), which would silently break stacking for marker
  // pins whose underlying DOM rect has not yet laid out. Falling back to
  // the pin square keeps clustering behaviour consistent.
  if (r.width !== undefined && r.height !== undefined && r.width > 0 && r.height > 0) {
    return { left: r.left, top: r.top, right: r.left + r.width, bottom: r.top + r.height };
  }
  const half = PIN_FALLBACK / 2;
  return { left: r.left - half, top: r.top - half, right: r.left + half, bottom: r.top + half };
}

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

export function layoutCollisions(items: CollisionItem[]): CollisionResult[] {
  const sorted = [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const n = sorted.length;
  const boxes = sorted.map((it) => toBox(it.rect));

  // Union-find connected components of overlapping rects.
  const parent = sorted.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (overlaps(boxes[i], boxes[j])) { const ra = find(i), rb = find(j); if (ra !== rb) parent[ra] = rb; }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const arr = groups.get(r);
    if (arr) arr.push(i); else groups.set(r, [i]);
  }
  // Stable group order: by smallest member index (= id-sorted, since `sorted` is id-sorted).
  const groupList = [...groups.values()].sort((a, b) => a[0] - b[0]);

  const out: CollisionResult[] = [];
  for (const idxs of groupList) {
    if (idxs.length === 1) {
      const it = sorted[idxs[0]];
      out.push({ kind: "single", id: it.id, rect: it.rect });
    } else if (idxs.length <= 3) {
      const ids = idxs.map((i) => sorted[i].id);
      idxs.forEach((i, off) => out.push({ kind: "stack", ids, rect: sorted[i].rect, offsetIndex: off, primaryId: ids[0] }));
    } else {
      const ids = idxs.map((i) => sorted[i].id);
      const bb = idxs.reduce<Box>((acc, i) => {
        const b = boxes[i];
        return { left: Math.min(acc.left, b.left), top: Math.min(acc.top, b.top), right: Math.max(acc.right, b.right), bottom: Math.max(acc.bottom, b.bottom) };
      }, boxes[idxs[0]]);
      out.push({ kind: "cluster", ids, rect: { top: bb.top, left: bb.left, width: bb.right - bb.left, height: bb.bottom - bb.top }, count: ids.length });
    }
  }
  return out;
}

export function useCollisionLayout(items: CollisionItem[]): CollisionResult[] {
  return useMemo(() => layoutCollisions(items), [items]);
}
