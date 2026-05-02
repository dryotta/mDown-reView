/**
 * Issue #352 / iter-12 — MRSF first-Editor-entry warning seen-flag.
 *
 * Thin wrapper over `seenFlag()` (`src/lib/excalidraw/seen-flag.ts`)
 * with the canonical localStorage key. Trigger semantics: the warning
 * fires the first time a user enters Editor mode for ANY Excalidraw
 * file (per browser profile). Pre-iter-11 the warning fired on first
 * successful save — under autosave the user has no explicit save
 * verb, so the trigger shifted to "first Editor entry" (proactive
 * disclosure). The localStorage key is unchanged so existing
 * installs aren't asked again.
 *
 * The seenFlag factory module is the SOLE writer of this key in
 * `localStorage`; this module is a typed alias for legacy import paths.
 */

import { seenFlag } from "./seen-flag";

const FLAG = seenFlag("mdownreview:excalidraw-first-save-warning-seen");

/**
 * Returns `true` when the user has not yet seen the MRSF warning toast
 * for any Excalidraw file (per browser profile). SSR / cookie-blocked
 * / private-mode: returns `true` (treat as already-seen so we don't
 * surface the warning in environments where we can't persist that we
 * showed it).
 */
export const hasSeenMrsfWarning = FLAG.has;

/**
 * Mark the MRSF warning as seen. Best-effort; SSR / cookie-blocked /
 * private-mode silently no-op.
 */
export const markMrsfWarningSeen = FLAG.mark;
