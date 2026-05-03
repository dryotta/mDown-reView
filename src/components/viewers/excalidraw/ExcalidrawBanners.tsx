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
      <button
        type="button"
        className="excalidraw-conflict-banner__action"
        onClick={onDismiss}
      >
        Dismiss
      </button>
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
