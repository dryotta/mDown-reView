/**
 * Issue #352 / iter-11 — auto-save banner seen-flag chokepoint.
 *
 * The "Changes save automatically." info banner in `ExcalidrawView`
 * teaches users that Excalidraw editor edits persist without an
 * explicit Save action. Once dismissed, it should stay dismissed
 * forever (per device / browser profile) — repeated dismissals every
 * launch would be naggy and unprofessional.
 *
 * This module is the SOLE writer of the seen-flag in `localStorage`.
 * Architecture: per the project-wide "no direct localStorage writes
 * outside the allowed chokepoints" gate at
 * `src/__tests__/forbid-localStorage-direct-write.test.ts`, every
 * `setItem`/`removeItem`/`clear` call must live in an allowlisted
 * file. Mirrors `first-save-warning.ts`.
 *
 * Failure handling: every `localStorage` access is wrapped in
 * try/catch so SSR / private mode / cookie-blocked-storage degrades
 * to "already seen" (the user just doesn't see the banner if storage
 * is unavailable — preferable to a banner that resists dismissal).
 */

const AUTOSAVE_BANNER_KEY = "mdownreview:excalidraw-autosave-banner-seen";

/**
 * Returns `true` when the user has dismissed the auto-save banner.
 * Defaults to `true` on storage failure so the banner doesn't
 * surface in environments where dismissal can't persist.
 */
export function hasSeenAutoSaveBanner(): boolean {
  try {
    return localStorage.getItem(AUTOSAVE_BANNER_KEY) === "1";
  } catch {
    return true;
  }
}

/**
 * Persist the user's dismissal of the auto-save banner. Best-effort;
 * SSR / cookie-blocked silently no-op.
 */
export function markAutoSaveBannerSeen(): void {
  try {
    localStorage.setItem(AUTOSAVE_BANNER_KEY, "1");
  } catch {
    // Ignore — best-effort write.
  }
}
