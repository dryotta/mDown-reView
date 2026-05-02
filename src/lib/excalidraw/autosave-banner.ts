/**
 * Issue #352 / iter-12 — auto-save info banner seen-flag.
 *
 * Thin wrapper over `seenFlag()` (`src/lib/excalidraw/seen-flag.ts`)
 * with the canonical localStorage key. The "Changes save automatically."
 * info banner in `ExcalidrawView` teaches users that Excalidraw editor
 * edits persist without an explicit Save action. Once dismissed, it
 * stays dismissed forever (per device / browser profile) — repeated
 * dismissals every launch would be naggy and unprofessional.
 *
 * The seenFlag factory module is the SOLE writer of this key in
 * `localStorage`; this module is a typed alias for legacy import paths.
 */

import { seenFlag } from "./seen-flag";

const FLAG = seenFlag("mdownreview:excalidraw-autosave-banner-seen");

/**
 * Returns `true` when the user has dismissed the auto-save banner.
 * Defaults to `true` on storage failure so the banner doesn't surface
 * in environments where dismissal can't persist.
 */
export const hasSeenAutoSaveBanner = FLAG.has;

/** Persist the user's dismissal of the auto-save banner. Best-effort. */
export const markAutoSaveBannerSeen = FLAG.mark;
