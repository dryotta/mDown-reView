import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/shallow";
import {
  useStore,
  type OnboardingSectionKey,
  type OnboardingStatus,
} from "@/store";
import { useAuthor } from "@/lib/vm/useAuthor";
import type { ConfigError } from "@/lib/tauri-commands";
// Styles for `.settings-dialog`, `.settings-row`, `.settings-switch`, etc. are
// loaded globally from `src/main.tsx` (see `@/styles/settings-view.css`).

/**
 * Issue #160 — Settings dialog (centered `<dialog>`, native focus trap).
 *
 * Follows the `AboutDialog` pattern: `showModal()` on mount, `cancel`
 * event for Esc, backdrop click to close. Merges the old author-editing
 * SettingsDialog inline, replacing the separate `authorDialogOpen` flow.
 *
 * Body is driven by `SETTINGS_CATEGORIES` — a typed descriptor array so
 * future iterations can add categories/rows without touching render logic.
 */

// ── Author-save helpers (ported from deleted SettingsDialog.tsx) ────────

const REASON_MESSAGES: Record<string, string> = {
  empty: "Name required",
  too_long: "Name is too long (max 128 bytes)",
  newline: "Name cannot contain line breaks",
  control_char: "Name cannot contain control characters",
};

function isConfigError(e: unknown): e is ConfigError {
  return typeof e === "object" && e !== null && "kind" in e;
}

// ── Typed category / row descriptors ───────────────────────────────────

type SettingsRowDescriptor =
  | { kind: "input"; key: string; label: string; description: string }
  | {
      kind: "switch";
      key: OnboardingSectionKey;
      label: string;
      description: string;
      install: (store: typeof useStore) => Promise<void>;
      remove?: (store: typeof useStore) => Promise<void>;
    }
  | { kind: "info"; key: string; label: string; description: string };

interface SettingsCategory {
  id: string;
  title: string;
  rows: readonly SettingsRowDescriptor[];
}

const SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
  {
    id: "general",
    title: "General",
    rows: [
      {
        kind: "input",
        key: "displayName",
        label: "Display name",
        description: "Name shown on comments you author.",
      },
    ],
  },
  {
    id: "integrations",
    title: "Integrations",
    rows: [
      {
        kind: "switch",
        key: "cliShim",
        label: "CLI shim",
        description:
          "Install the `mdownreview` CLI to open files from the terminal.",
        install: (s) => s.getState().installCliShim(),
        remove: (s) => s.getState().removeCliShim(),
      },
      {
        kind: "switch",
        key: "defaultHandler",
        label: "Default handler",
        description:
          "Make mdownreview the default app for `.md`/`.mdx` files.",
        install: (s) => s.getState().setDefaultHandler(),
        // No remove IPC — switch is read-only once "done".
      },
    ],
  },
];

// ── Sub-components ─────────────────────────────────────────────────────

const STATUS_BADGE: Record<OnboardingStatus, string> = {
  done: "installed",
  pending: "missing",
  unsupported: "unsupported",
  error: "error",
};

interface SwitchProps {
  label: string;
  checked: boolean;
  pending: boolean;
  disabled: boolean;
  onToggle: () => void;
}

function Switch({ label, checked, pending, disabled, onToggle }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      aria-busy={pending}
      disabled={disabled || pending}
      onClick={onToggle}
      className={`settings-switch${checked ? " settings-switch-on" : ""}`}
    >
      <span className="settings-switch-thumb" aria-hidden="true" />
    </button>
  );
}

// ── Main component ─────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
}

export function SettingsView({ onClose }: Props) {
  const { statuses, errors } = useStore(
    useShallow((s) => ({
      statuses: s.onboardingStatuses,
      errors: s.onboardingErrors,
    })),
  );

  // Author (merged from deleted SettingsDialog)
  const { author, setAuthor } = useAuthor();
  // Hydration race: when the dialog mounts before `useAuthor`'s `get_author`
  // IPC resolves, `author` arrives as `""` and a useState(author) snapshot
  // would freeze the empty value. Track the edited draft separately and
  // fall back to the live `author` until the user types.
  const [editedDraft, setEditedDraft] = useState<string | null>(null);
  const draft = editedDraft ?? author;
  const [authorError, setAuthorError] = useState<string | null>(null);
  const [authorSaving, setAuthorSaving] = useState(false);

  const dialogRef = useRef<HTMLDialogElement>(null);

  // Open as a modal on mount. `showModal` provides the focus trap + Esc
  // handler + inert backdrop. We deliberately do NOT call `close()` from
  // cleanup: the dialog is removed from the DOM when this component
  // unmounts, and an explicit `close()` would dispatch the native
  // `close` event into our `onClose` handler, racing the unmount under
  // React StrictMode.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) {
      try {
        dialog.showModal();
      } catch {
        // showModal can throw if the dialog is already open in a stale
        // tree — best-effort, continue rendering.
      }
    }
  }, []);

  // Refresh once on mount — keeps the view honest if the user navigated in
  // after platform state changed under us (manual Finder/Explorer edits).
  useEffect(() => {
    void useStore.getState().refreshOnboarding();
  }, []);

  // ── Per-switch in-flight state ─────────────────────────────────────
  const [pending, setPending] = useState<Record<OnboardingSectionKey, boolean>>({
    cliShim: false,
    defaultHandler: false,
  });

  // ── Author save ────────────────────────────────────────────────────
  const handleAuthorSave = async () => {
    setAuthorError(null);
    setAuthorSaving(true);
    try {
      await setAuthor(draft);
    } catch (e) {
      if (isConfigError(e)) {
        if (e.kind === "InvalidAuthor") {
          setAuthorError(REASON_MESSAGES[e.reason] ?? "Invalid name");
        } else {
          setAuthorError(`Could not save: ${e.message}`);
        }
      } else {
        setAuthorError("Could not save settings");
      }
    } finally {
      setAuthorSaving(false);
    }
  };

  // ── Switch toggle handler ──────────────────────────────────────────
  const handleToggle = (desc: Extract<SettingsRowDescriptor, { kind: "switch" }>) => () => {
    const status = statuses[desc.key];
    const action =
      status === "done" ? (desc.remove ? "remove" : "noop") : "install";
    const fn =
      action === "install"
        ? () => desc.install(useStore)
        : action === "remove" && desc.remove
          ? () => desc.remove!(useStore)
          : undefined;
    if (!fn) return;
    setPending((p) => ({ ...p, [desc.key]: true }));
    void fn().finally(() => {
      setPending((p) => ({ ...p, [desc.key]: false }));
    });
  };

  // ── Row renderer (discriminated on `kind`) ─────────────────────────
  const renderRow = (row: SettingsRowDescriptor) => {
    switch (row.kind) {
      case "input": {
        return (
          <div
            key={row.key}
            className="settings-row settings-row-input"
            data-testid={`settings-row-${row.key}`}
          >
            <label className="settings-row-label" htmlFor={`settings-${row.key}`}>
              {row.label}
            </label>
            <input
              id={`settings-${row.key}`}
              type="text"
              className="settings-input"
              value={draft}
              onChange={(e) => {
                setEditedDraft(e.target.value);
                if (authorError) setAuthorError(null);
              }}
              onBlur={() => void handleAuthorSave()}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !authorSaving) {
                  e.preventDefault();
                  void handleAuthorSave();
                }
                // Esc handled by native <dialog> `cancel` event.
              }}
              maxLength={128}
              disabled={authorSaving}
            />
            <div className="settings-row-description">{row.description}</div>
            {authorError && (
              <div
                className="settings-row-error"
                role="alert"
                data-testid="settings-row-error-displayName"
              >
                {authorError}
              </div>
            )}
          </div>
        );
      }
      case "switch": {
        const status = statuses[row.key];
        const error = errors[row.key];
        const isPending = pending[row.key];
        const checked = status === "done";
        const action =
          status === "done" ? (row.remove ? "remove" : "noop") : "install";
        const hideSwitch = status === "unsupported" || action === "noop";
        const fallbackText =
          status === "unsupported"
            ? "Not available on this platform."
            : action === "noop"
              ? "Already the default — change in System Settings."
              : null;
        return (
          <div
            key={row.key}
            className="settings-row"
            data-testid={`settings-row-${row.key}`}
          >
            <div className="settings-row-main">
              <span className="settings-row-label">{row.label}</span>
              <span
                className={`settings-row-badge settings-row-badge-${status}`}
                data-testid={`settings-row-badge-${row.key}`}
              >
                {STATUS_BADGE[status]}
              </span>
            </div>
            {hideSwitch ? (
              <span
                className="settings-row-fallback"
                data-testid={`settings-row-fallback-${row.key}`}
              >
                {fallbackText}
              </span>
            ) : (
              <Switch
                label={row.label}
                checked={checked}
                pending={isPending}
                disabled={false}
                onToggle={handleToggle(row)}
              />
            )}
            <div
              className="settings-row-description"
              data-testid={`settings-row-description-${row.key}`}
            >
              {row.description}
            </div>
            {error && (
              <div
                className="settings-row-error"
                role="alert"
                data-testid={`settings-row-error-${row.key}`}
              >
                {error}
              </div>
            )}
          </div>
        );
      }
      case "info": {
        return (
          <div
            key={row.key}
            className="settings-row settings-row-info"
            data-testid={`settings-row-${row.key}`}
          >
            <span className="settings-row-label">{row.label}</span>
            <div className="settings-row-description">{row.description}</div>
          </div>
        );
      }
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="settings-dialog"
      aria-labelledby="settings-title"
      onCancel={(e) => {
        // Native `cancel` fires on Esc. Prevent the default close so we
        // route through the parent's onClose which owns the open flag.
        e.preventDefault();
        onClose();
      }}
      onClose={onClose}
      onClick={(e) => {
        // Click on the backdrop (the dialog element itself, not its
        // contents) closes — preserves the previous overlay-click UX.
        if (e.target === dialogRef.current) onClose();
      }}
    >
      <div className="settings-dialog-content">
        <div className="dialog-header">
          <h2 id="settings-title">Settings</h2>
          <button className="dialog-close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
            </svg>
          </button>
        </div>
        <div className="settings-body">
          {SETTINGS_CATEGORIES.map((cat) => (
            <section key={cat.id} className="settings-category" data-testid={`settings-category-${cat.id}`}>
              <h3 className="settings-category-title">{cat.title}</h3>
              {cat.rows.map((row) => renderRow(row))}
            </section>
          ))}
        </div>
      </div>
    </dialog>
  );
}
