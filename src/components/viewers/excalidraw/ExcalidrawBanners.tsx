/**
 * Issue #352 / iter-12 — Excalidraw banner UIs.
 *
 * Four non-modal UI surfaces that render above the canvas in
 * `ExcalidrawView`:
 *   - **FirstEntryBanner**: one-shot disclosure on first Editor entry.
 *     Combines the iter-12 autosave-info + MRSF warning into a single
 *     dismissible message (review finding product-expert P0-2 + P0-3:
 *     stacking two banners ate canvas height; "line-anchored comments"
 *     was internal jargon for the target user).
 *   - **SaveErrorBanner**: surfaces Rust workspace-write failures with
 *     friendly copy + Retry/Resume + Dismiss actions.
 *   - **ConflictBanner**: external file change while editor is dirty —
 *     [Reload] / [Keep my edits] choices with primary/destructive
 *     button styling (review finding product-expert P0-4: identical
 *     button styling made the destructive option read as the safer
 *     one).
 *   - **SavedPill**: transient toast confirming a Cmd+S flush.
 *
 * Extracted from `ExcalidrawView.tsx` in iter-12 (architect blocker
 * #1 — file size cap rule 23 in `docs/architecture.md`). Each banner
 * is a stateless presentational component; the parent owns all
 * lifecycle + dismissal logic.
 */

interface FirstEntryBannerProps {
  onDismiss: () => void;
}

/**
 * One-shot disclosure shown on first Editor-mode entry per browser
 * profile. Dismissed forever once the user clicks "Got it".
 *
 * Combined disclosure (review finding product-expert P0-2):
 *   1. Editor saves changes automatically (the autosave behaviour
 *      itself — users who haven't seen autosave-only file editors are
 *      told once that there is no Save button).
 *   2. Rewriting the underlying JSON may move comments pinned to
 *      specific lines onto the file as a whole (de-jargonized MRSF
 *      warning — "line-anchored comments" → "comments pinned to
 *      specific lines"; "file-level" → "the whole file"). Surfaces
 *      proactively so the user's first edit-becomes-save isn't a
 *      surprise.
 */
export function FirstEntryBanner({ onDismiss }: FirstEntryBannerProps) {
  return (
    <div
      className="excalidraw-first-entry-banner"
      role="status"
      data-testid="excalidraw-first-entry-banner"
    >
      <span className="excalidraw-first-entry-banner__copy">
        Editor saves changes automatically as you draw. Editing rewrites
        the underlying JSON — comments pinned to specific lines may move
        to the whole file on save.
      </span>
      <button
        type="button"
        className="excalidraw-conflict-banner__action"
        onClick={onDismiss}
        data-testid="excalidraw-first-entry-banner-dismiss"
      >
        Got it
      </button>
    </div>
  );
}

/**
 * Iter-22 (#352 product-expert iter-21 P0 — MRSF re-anchor "once per
 * profile" gap) — per-file warning shown when the user enters Editor
 * mode for an `.excalidraw[lib]` file that has line-anchored review
 * comments at risk of degrading to file-level on the next save.
 *
 * The `FirstEntryBanner` is shown ONCE per browser profile. A user who
 * dismissed it months ago and today reopens an old `.excalidraw` with
 * carefully-line-anchored comments their colleague wrote would lose
 * those anchors on the next stroke without any UI signal — a direct
 * Reliable-pillar violation ("comments are indestructible"). This
 * banner re-surfaces the risk **with a count** every time the user
 * enters Editor mode on a file that genuinely has line-anchored
 * comments. Session-scoped dismissal: clicking "Got it, keep editing"
 * suppresses the banner for this path for the remainder of the
 * session, so the user is not nagged every mode-toggle. New sessions
 * (app restart) re-warn — the cost of the alert is one click; the
 * cost of silently degrading another reviewer's comment thread is
 * irreversible (the original line anchor cannot be recovered post-
 * promotion).
 */
interface LineAnchoredCommentsBannerProps {
  count: number;
  onDismiss: () => void;
}

export function LineAnchoredCommentsBanner({
  count,
  onDismiss,
}: LineAnchoredCommentsBannerProps) {
  // Singular / plural copy without an external i18n dep.
  const noun = count === 1 ? "comment" : "comments";
  return (
    <div
      className="excalidraw-line-anchored-banner"
      role="alert"
      data-testid="excalidraw-line-anchored-banner"
      data-count={String(count)}
    >
      <span className="excalidraw-line-anchored-banner__copy">
        This file has {count} review {noun} pinned to specific lines.
        Editing rewrites the underlying JSON — some may move to the
        whole file on save.
      </span>
      <button
        type="button"
        className="excalidraw-conflict-banner__action"
        onClick={onDismiss}
        data-testid="excalidraw-line-anchored-banner-dismiss"
      >
        Got it, keep editing
      </button>
    </div>
  );
}

interface SaveErrorBannerProps {
  message: string;
  paused: boolean;
  onRetry: () => void;
  onDismiss: () => void;
}

export function SaveErrorBanner({
  message,
  paused,
  onRetry,
  onDismiss,
}: SaveErrorBannerProps) {
  return (
    <div
      className="excalidraw-save-error-banner"
      role="alert"
      data-testid="excalidraw-save-error-banner"
    >
      <span className="excalidraw-save-error-banner__copy">
        {paused
          ? `Auto-save paused after repeated failures: ${message}`
          : `Couldn't save your changes: ${message}`}
      </span>
      <button
        type="button"
        className="excalidraw-conflict-banner__action"
        onClick={onRetry}
        data-testid="excalidraw-save-error-retry"
      >
        {paused ? "Resume" : "Retry"}
      </button>
      {/*
       * Iter-21 (#352 product-expert P0-1): Dismiss is rendered ONLY
       * in the recoverable-error state. When `paused === true`,
       * autosave is HALTED until the user clicks Resume — and the
       * banner is the only on-canvas affordance signalling that
       * fact. Pre-iter-21 a Dismiss button rendered identically in
       * both states; the user could click it during pause, the
       * banner would vanish, and they'd keep drawing into an
       * autosave-disabled session with no UI signal. Edits then
       * lived in RAM only until the close-flush handshake (best-
       * effort over CloseRequested only). The banner now stays
       * pinned in the paused state until the user explicitly
       * acknowledges by clicking Resume — failure-pause is no
       * longer dismissible.
       */}
      {!paused && (
        <button
          type="button"
          className="excalidraw-conflict-banner__action"
          onClick={onDismiss}
          data-testid="excalidraw-save-error-dismiss"
        >
          Dismiss
        </button>
      )}
    </div>
  );
}

interface ConflictBannerProps {
  onReload: () => void;
  onKeepEditing: () => void;
}

export function ConflictBanner({ onReload, onKeepEditing }: ConflictBannerProps) {
  return (
    <div
      className="excalidraw-conflict-banner"
      role="status"
      data-testid="excalidraw-conflict-banner"
    >
      <span className="excalidraw-conflict-banner__copy">
        File changed on disk
      </span>
      {/* Reload is styled as the primary action (filled). Per
          product-expert P0-4: pre-fix both buttons looked identical and
          the destructive option ("overwrite") had the wordier label,
          which read as the "safer" choice via more reassuring text. */}
      <button
        type="button"
        className="excalidraw-conflict-banner__action excalidraw-conflict-banner__action--primary"
        onClick={onReload}
        data-testid="excalidraw-conflict-banner-reload"
      >
        Reload (discard my edits)
      </button>
      {/* Destructive action: outlined-destructive styling so it cannot
          be mistaken for the safer / recommended path. */}
      <button
        type="button"
        className="excalidraw-conflict-banner__action excalidraw-conflict-banner__action--destructive"
        onClick={onKeepEditing}
        data-testid="excalidraw-conflict-banner-keep-editing"
      >
        Keep my edits (overwrite disk)
      </button>
    </div>
  );
}

export function SavedPill() {
  return (
    <div
      className="excalidraw-saved-pill"
      role="status"
      data-testid="excalidraw-saved-pill"
    >
      Saved
    </div>
  );
}

/**
 * Iter-21 (#352 product-expert P0-2) — persistent save-status
 * indicator pinned to the top-right of the canvas. Replaces the
 * affordance gap left by the autosave-only design: the user has no
 * Save button, no document-edited indicator, and the transient
 * SavedPill flashes only on Cmd+S successes. Without this indicator
 * a user who pauses for a beat after editing could not tell whether
 * their changes had landed on disk.
 *
 * States (priority order — first matching wins):
 *   - **paused**: 3-strike failure-pause is active. Iter-22 (#352
 *     bug-expert iter-21 P1-3): pre-iter-22 the indicator showed
 *     "Unsaved" while paused (`saveError && !autoSavePaused` excluded
 *     the paused state from "failed"), actively lying — "Unsaved" is
 *     a forward-looking promise that the autosave loop will catch up
 *     in 2 s, but autosave is HALTED until the user clicks Resume.
 *     The dedicated "paused" state agrees with the SaveErrorBanner's
 *     "Auto-save paused after repeated failures" copy.
 *   - **failed**: a fresh save IPC rejected and we are NOT yet
 *     paused — the failure counter is still below threshold and the
 *     debounce will retry. SaveErrorBanner shows the error reason +
 *     Retry/Dismiss; the indicator confirms.
 *   - **saving**: `saveInFlight === true` — IPC is in flight.
 *   - **unsaved**: `dirty === true` — pending edit waiting to debounce
 *     or coalesce with an in-flight save.
 *   - **saved**: otherwise — last persisted state matches the live
 *     scene + library.
 */
export type SaveStatus = "saved" | "unsaved" | "saving" | "failed" | "paused";

interface SaveStatusIndicatorProps {
  status: SaveStatus;
}

export function SaveStatusIndicator({ status }: SaveStatusIndicatorProps) {
  const copy: Record<SaveStatus, string> = {
    saved: "Saved",
    unsaved: "Unsaved",
    saving: "Saving…",
    failed: "Save failed",
    paused: "Auto-save paused",
  };
  return (
    <div
      className={`excalidraw-save-status excalidraw-save-status--${status}`}
      role="status"
      aria-live="polite"
      data-testid="excalidraw-save-status"
      data-status={status}
    >
      <span className="excalidraw-save-status__dot" aria-hidden="true" />
      <span className="excalidraw-save-status__copy">{copy[status]}</span>
    </div>
  );
}
