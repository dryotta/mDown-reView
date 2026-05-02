/**
 * Issue #352 / iter-5 — first-save warning seen-flag chokepoint.
 *
 * The original spec at issue #352 requires a one-shot onboarding-style
 * note on the first successful save of any Excalidraw file:
 *   "Saving a drawing may move some line-anchored comments to file-level."
 *
 * This module is the SOLE writer of the seen-flag in `localStorage`.
 * Architecture: per the project-wide "no direct localStorage writes
 * outside the allowed chokepoints" gate at
 * `src/__tests__/forbid-localStorage-direct-write.test.ts`, every
 * `setItem`/`removeItem`/`clear` call must live in an allowlisted
 * file. Adding this module to that allowlist keeps the gate honest:
 * the persistence concern lives behind a typed function instead of
 * being scattered across viewer code.
 *
 * `getItem` reads are unrestricted by the gate, so this module is the
 * only place the WRITE happens — readers can call `hasSeenFirstSave`
 * directly inline.
 *
 * Failure handling: every `localStorage` access is wrapped in
 * try/catch so SSR / private mode / cookie-blocked-storage degrades
 * to "never seen" (writes silently no-op) — preferable to crashing
 * the save flow on an environmental issue.
 */

const FIRST_SAVE_KEY = "mdownreview:excalidraw-first-save-warning-seen";

/**
 * Returns `true` when the user has not yet seen the first-save MRSF
 * warning toast for any Excalidraw file (per browser profile).
 *
 * SSR / cookie-blocked / private-mode: returns `false` (treat as
 * already-seen so we don't surface the warning in environments where
 * we can't persist that we showed it).
 */
export function hasSeenFirstSave(): boolean {
  try {
    return localStorage.getItem(FIRST_SAVE_KEY) === "1";
  } catch {
    return true;
  }
}

/**
 * Mark the first-save warning as seen. Best-effort; SSR / cookie-blocked
 * / private-mode silently no-op (the user will see the warning again
 * next time, which is acceptable for an environmental degrade).
 */
export function markFirstSaveSeen(): void {
  try {
    localStorage.setItem(FIRST_SAVE_KEY, "1");
  } catch {
    // Ignore — best-effort write.
  }
}
