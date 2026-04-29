import { useEffect, useRef, useState } from "react";
import { useStore } from "@/store";
import {
  getSidecarConfig,
  setSidecarConfig,
  migrateSidecars,
  type SidecarConfigResult,
} from "@/lib/tauri-commands";
import { warn } from "@/logger";
import "@/styles/sidecar-config-dialog.css";

interface Props {
  root: string;
  onClose: () => void;
}

/** Render an IPC rejection (string | Error | unknown) as a user-facing string. */
function formatErr(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function SidecarConfigDialog({ root, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [config, setConfig] = useState<SidecarConfigResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [migrateResult, setMigrateResult] = useState<{
    moved: number;
    failed: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const showSidecarFiles = useStore((s) => s.showSidecarFiles);
  const toggleShowSidecarFiles = useStore((s) => s.toggleShowSidecarFiles);

  // Open as modal on mount (same pattern as AboutDialog/SettingsView).
  // Deliberately omit close() in cleanup — the dialog leaves the DOM on
  // unmount and an explicit close() would dispatch the native `close` event
  // into onClose, racing the unmount under React StrictMode.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) {
      try {
        dialog.showModal();
      } catch {
        // showModal can throw InvalidStateError if already open in a
        // stale tree (StrictMode double-invoke) — best-effort.
      }
    }
  }, []);

  // Load config on mount
  useEffect(() => {
    let cancelled = false;
    setLoading(true); // eslint-disable-line react-hooks/set-state-in-effect -- initial async load
    getSidecarConfig(root)
      .then((result) => {
        if (!cancelled) setConfig(result);
      })
      .catch((err) => {
        const msg = formatErr(err);
        warn(`[SidecarConfigDialog] load failed: ${msg}`);
        if (!cancelled) setError(`Failed to load sidecar config: ${msg}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [root]);

  // Toggle .reviews/ folder
  const handleToggleEnabled = async () => {
    if (!config) return;
    setLoading(true);
    setError(null);
    try {
      const result = await setSidecarConfig(root, !config.enabled);
      setConfig(result);
      setMigrateResult(null);
    } catch (err) {
      const msg = formatErr(err);
      void warn(`[SidecarConfigDialog] toggle failed: ${msg}`);
      setError(`Failed to update sidecar config: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  // Migrate sidecars
  const handleMigrate = async () => {
    if (!config) return;
    setMigrating(true);
    setMigrateResult(null);
    setError(null);
    try {
      // Direction tracks the toggle: enabled means move co-located → folder,
      // disabled means rescue stranded folder files → co-located. The
      // backend now mirrors `count_sidecars`'s `.reviews/` fallback so the
      // disabled-with-stranded-files rescue path works without re-enabling.
      const direction = config.enabled ? "to_folder" : "to_colocated";
      const result = await migrateSidecars(root, direction);
      setConfig(result.config);
      setMigrateResult({ moved: result.moved, failed: result.failed });
    } catch (err) {
      const msg = formatErr(err);
      void warn(`[SidecarConfigDialog] migrate failed: ${msg}`);
      setError(`Migration failed: ${msg}`);
    } finally {
      setMigrating(false);
    }
  };

  // Derive migration UI state
  const fromCount = config?.enabled ? config.count_colocated : (config?.count_in_folder ?? 0);
  const toCount = config?.enabled ? config.count_in_folder : (config?.count_colocated ?? 0);
  const fromLabel = config?.enabled ? "Co-located" : ".reviews/";
  const toLabel = config?.enabled ? ".reviews/" : "Co-located";
  const canMigrate = fromCount > 0;

  let migrateButtonText: string;
  if (!canMigrate) {
    migrateButtonText = `All review files in ${toLabel} ✓`;
  } else if (config?.enabled) {
    migrateButtonText = `Move ${fromCount} co-located → .reviews/`;
  } else {
    migrateButtonText = `Move ${fromCount} from .reviews/ → co-located`;
  }

  return (
    <dialog
      ref={dialogRef}
      className="sidecar-config-dialog"
      aria-labelledby="sidecar-config-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // Backdrop click: target is the dialog element itself, not children.
        if (e.target === dialogRef.current) onClose();
      }}
    >
      <div className="sidecar-config-dialog-content">
        <div className="dialog-header">
          <h2 id="sidecar-config-title">.review.yaml Sidecar Config</h2>
          <button className="dialog-close" onClick={onClose} aria-label="Close">
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="currentColor"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
            </svg>
          </button>
        </div>

        <div className="sidecar-config-body">
          {error && (
            <div className="sidecar-config-error" role="alert">
              <span className="sidecar-config-error-text">{error}</span>
              <button
                type="button"
                className="sidecar-config-error-dismiss"
                onClick={() => setError(null)}
                aria-label="Dismiss error"
              >
                ×
              </button>
            </div>
          )}
          {loading && !config ? (
            <div className="sidecar-config-loading">Loading…</div>
          ) : config ? (
            <>
              {/* Toggle: Use .reviews/ folder */}
              <div className="sidecar-config-section">
                <div className="settings-row">
                  <div>
                    <div className="settings-row-label">Use .reviews/ folder</div>
                    <div className="settings-row-description">
                      {config.enabled
                        ? "New review sidecars are stored under .reviews/"
                        : "Sidecars are co-located next to source files (default)"}
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-label="Use .reviews/ folder"
                    aria-checked={config.enabled}
                    aria-busy={loading}
                    disabled={loading}
                    onClick={handleToggleEnabled}
                    className={`settings-switch${config.enabled ? " settings-switch-on" : ""}`}
                  >
                    <span className="settings-switch-thumb" aria-hidden="true" />
                  </button>
                </div>
              </div>

              {/* Migration section */}
              <div className="sidecar-config-section">
                <div className="sidecar-config-migration">
                  <div className="sidecar-config-counts">
                    <div className="sidecar-config-count-box">
                      <div className="sidecar-config-count-value">{fromCount}</div>
                      <div className="sidecar-config-count-label">{fromLabel}</div>
                    </div>
                    <span className="sidecar-config-arrow">→</span>
                    <div className="sidecar-config-count-box sidecar-config-count-active">
                      <div className="sidecar-config-count-value">{toCount}</div>
                      <div className="sidecar-config-count-label">{toLabel} ✓</div>
                    </div>
                  </div>
                  <button
                    className="sidecar-config-migrate-btn"
                    onClick={handleMigrate}
                    disabled={!canMigrate || migrating || loading}
                  >
                    {migrating ? "Moving…" : migrateButtonText}
                  </button>
                  {migrateResult && (
                    <div className="sidecar-config-result">
                      {migrateResult.moved > 0 && (
                        <span className="sidecar-config-result-success">
                          ✓ Moved {migrateResult.moved} file
                          {migrateResult.moved !== 1 ? "s" : ""}
                        </span>
                      )}
                      {migrateResult.failed.length > 0 && (
                        <span className="sidecar-config-result-error">
                          ✗ {migrateResult.failed.length} failed
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Divider */}
              <hr className="sidecar-config-divider" />

              {/* Toggle: Show sidecar files in folder pane */}
              <div className="sidecar-config-section">
                <div className="settings-row">
                  <div>
                    <div className="settings-row-label">Show sidecar files in folder pane</div>
                    <div className="settings-row-description">
                      When enabled, .review.yaml/.review.json files appear in the folder tree
                      (dimmed/italic).
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-label="Show sidecar files in folder pane"
                    aria-checked={showSidecarFiles}
                    onClick={toggleShowSidecarFiles}
                    className={`settings-switch${showSidecarFiles ? " settings-switch-on" : ""}`}
                  >
                    <span className="settings-switch-thumb" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </dialog>
  );
}
