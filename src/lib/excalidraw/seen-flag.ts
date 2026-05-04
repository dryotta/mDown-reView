/**
 * Issue #352 / iter-12 (Lean cut B15) — single chokepoint for boolean
 * "user has dismissed this banner" flags persisted in `localStorage`.
 *
 * Two banners in the Excalidraw integration use this:
 *   - "Changes save automatically." (auto-save info banner)
 *   - "Saving may move some line-anchored comments to file-level."
 *     (MRSF first-Editor-entry warning)
 *
 * Previously each was its own ~50 LoC module
 * (`autosave-banner.ts`, `first-save-warning.ts`) with identical
 * `try/getItem === "1"` reader, `try/setItem("1")` writer, and SSR /
 * private-mode degradation. This factory collapses all three concerns
 * into one typed helper. Adding a third banner is now a single
 * `seenFlag(KEY)` call — not a 50-line copy-paste.
 *
 * Architecture: this module is the SOLE writer of the flagged keys in
 * `localStorage`. The project-wide gate at
 * `src/__tests__/forbid-localStorage-direct-write.test.ts` allowlists
 * this file (replaces the two prior allowlist entries).
 *
 * SSR / private-mode / cookie-blocked storage degrades to "already
 * seen" on read failure (banner suppressed in environments where we
 * can't persist dismissal), and silent no-op on write failure.
 */

export interface SeenFlag {
  /** Returns `true` when the user has dismissed the banner. */
  has: () => boolean;
  /** Persist dismissal (best-effort; SSR / private-mode silently no-op). */
  mark: () => void;
}

export function seenFlag(key: string): SeenFlag {
  return {
    has: () => {
      try {
        return localStorage.getItem(key) === "1";
      } catch {
        return true;
      }
    },
    mark: () => {
      try {
        localStorage.setItem(key, "1");
      } catch {
        // Ignore — best-effort write.
      }
    },
  };
}
