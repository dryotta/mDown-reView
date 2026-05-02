/**
 * Issue #352 / iter-5 (first-save) → iter-11 (first Editor entry) —
 * MRSF warning seen-flag chokepoint.
 *
 * The original spec required a one-shot onboarding-style note on the
 * first successful save of any Excalidraw file:
 *   "Saving a drawing may move some line-anchored comments to file-level."
 *
 * iter-11 redesign (auto-save) shifted the trigger to "first time the
 * user enters Editor mode for any Excalidraw file" — under auto-save
 * the warning needs to surface BEFORE the first edit (which becomes a
 * save automatically), not after. Same warning copy, earlier trigger.
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
 * only place the WRITE happens — readers can call `hasSeenMrsfWarning`
 * directly inline.
 *
 * Failure handling: every `localStorage` access is wrapped in
 * try/catch so SSR / private mode / cookie-blocked-storage degrades
 * to "never seen" (writes silently no-op) — preferable to crashing
 * the save flow on an environmental issue.
 */

// iter-11 keeps the iter-5 key so existing user installs aren't asked
// again. The semantic shifted from "first save" to "first Editor entry"
// but the user-facing message is unchanged so the dismissal carries
// over correctly.
const MRSF_SEEN_KEY = "mdownreview:excalidraw-first-save-warning-seen";

/**
 * Returns `true` when the user has not yet seen the MRSF warning toast
 * for any Excalidraw file (per browser profile).
 *
 * SSR / cookie-blocked / private-mode: returns `true` (treat as
 * already-seen so we don't surface the warning in environments where
 * we can't persist that we showed it).
 */
export function hasSeenMrsfWarning(): boolean {
  try {
    return localStorage.getItem(MRSF_SEEN_KEY) === "1";
  } catch {
    return true;
  }
}

/**
 * Mark the MRSF warning as seen. Best-effort; SSR / cookie-blocked /
 * private-mode silently no-op (the user will see the warning again
 * next time, which is acceptable for an environmental degrade).
 */
export function markMrsfWarningSeen(): void {
  try {
    localStorage.setItem(MRSF_SEEN_KEY, "1");
  } catch {
    // Ignore — best-effort write.
  }
}

// iter-5 → iter-11 alias retention. The previous names imply
// "first save" semantics; the new names are neutral. Kept as
// re-exports so test suites and other importers don't break in this
// PR. Will be removed in a follow-up after callers migrate.
export { hasSeenMrsfWarning as hasSeenFirstSave };
export { markMrsfWarningSeen as markFirstSaveSeen };
