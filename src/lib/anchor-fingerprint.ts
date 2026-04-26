// Stable, sync fingerprinting for `Anchor` values. Used to derive
// localStorage draft keys that survive reload — the key must be identical
// across remounts/reloads for the same logical anchor location, even if
// payload object keys arrive in a different order. Sync by design (no
// Web Crypto / Promise) so call-sites can compute keys at render time.

import type { Anchor } from "@/types/comments";

// Recursively serialize with sorted keys at every object level. Arrays are
// kept in their natural order (their order is part of the identity for the
// anchor variants that contain arrays). `undefined` properties are dropped
// so that adding/removing optional fields late doesn't perturb the hash for
// callers that pass an explicit `undefined`.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

/**
 * Produce a deterministic JSON projection of an anchor that is independent
 * of source-key order. Covers all 8 `Anchor` variants — the discriminator
 * `kind` is included alongside the per-variant payload.
 */
export function canonicalizeAnchor(anchor: Anchor): string {
  return stableStringify(anchor);
}

/**
 * Sync 8-char hex fingerprint via FNV-1a 32-bit fold of the canonical
 * anchor string. Not cryptographic — collision-resistance only matters
 * across the small set of open drafts in a single session.
 */
export function fingerprintAnchor(anchor: Anchor): string {
  const s = canonicalizeAnchor(anchor);
  // FNV-1a 32-bit
  let hash = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    // Multiply by FNV prime 16777619, mod 2^32
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
