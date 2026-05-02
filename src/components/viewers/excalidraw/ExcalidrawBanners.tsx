/**
 * Issue #352 / iter-12 — Excalidraw banner UIs.
 *
 * Five non-modal UI surfaces that render above the canvas in
 * `ExcalidrawView`:
 *   - **AutoSaveInfoBanner**: one-shot disclosure that edits save
 *     automatically (dismissible, persisted in `localStorage`).
 *   - **MrsfWarningBanner**: one-shot warning that line-anchored
 *     comments may degrade on save (dismissible, persisted).
 *   - **SaveErrorBanner**: surfaces Rust workspace-write failures with
 *     friendly copy + Retry/Resume + Dismiss actions.
 *   - **ConflictBanner**: external file change while editor is dirty —
 *     [Reload] / [Keep editing] choices.
 *   - **SavedPill**: transient toast confirming a Cmd+S flush.
 *
 * Extracted from `ExcalidrawView.tsx` in iter-12 (architect blocker
 * #1 — file size cap rule 23 in `docs/architecture.md`). Each banner
 * is a stateless presentational component; the parent owns all
 * lifecycle + dismissal logic.
 */

interface AutoSaveInfoBannerProps {
  onDismiss: () => void;
}

export function AutoSaveInfoBanner({ onDismiss }: AutoSaveInfoBannerProps) {
  return (
    <div
      className="excalidraw-autosave-banner"
      role="status"
      data-testid="excalidraw-autosave-banner"
    >
      <span className="excalidraw-autosave-banner__copy">
        Changes save automatically.
      </span>
      <button
        type="button"
        className="excalidraw-conflict-banner__action"
        onClick={onDismiss}
        data-testid="excalidraw-autosave-banner-dismiss"
      >
        Got it
      </button>
    </div>
  );
}

interface MrsfWarningBannerProps {
  onDismiss: () => void;
}

export function MrsfWarningBanner({ onDismiss }: MrsfWarningBannerProps) {
  return (
    <div
      className="excalidraw-first-save-warning-banner"
      role="status"
      data-testid="excalidraw-first-save-warning-banner"
    >
      <span className="excalidraw-first-save-warning-banner__copy">
        Saving a drawing may move some line-anchored comments to file-level.
      </span>
      <button
        type="button"
        className="excalidraw-conflict-banner__action"
        onClick={onDismiss}
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
      <button
        type="button"
        className="excalidraw-conflict-banner__action"
        onClick={onReload}
      >
        Reload
      </button>
      <button
        type="button"
        className="excalidraw-conflict-banner__action"
        onClick={onKeepEditing}
      >
        Keep editing — your changes will overwrite the version on disk
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
