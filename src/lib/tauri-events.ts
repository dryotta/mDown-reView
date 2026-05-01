// Single chokepoint for ALL Tauri event listeners. Mirror of the IPC
// chokepoint in `@/lib/tauri-commands`. Production code outside this file
// MUST NOT import `@tauri-apps/api/event` directly — see
// `src/__tests__/event-chokepoint.test.ts` for the architectural assertion.

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { debug } from "@/logger";

export type { UnlistenFn };

/**
 * Lazily-resolved current-window label. Tauri's `getCurrentWebviewWindow()`
 * reads `window.__TAURI_INTERNALS__.metadata` which is undefined in
 * jsdom (vitest), so eager evaluation at module load breaks every
 * test that imports anything that imports this file. Resolve on
 * first call instead and cache the result. The first invocation
 * also logs the label so the log file shows which window each
 * subsequent `[tauri-events] received` line came from.
 *
 * The fallback `"unknown"` is purely a test-environment placeholder;
 * in production Tauri always populates the metadata.
 */
let cachedLabel: string | null = null;
function currentLabel(): string {
  if (cachedLabel !== null) return cachedLabel;
  try {
    cachedLabel = getCurrentWebviewWindow().label;
  } catch {
    cachedLabel = "unknown";
  }
  void debug(
    `[tauri-events] listener-target initialised — window-label=${cachedLabel}`,
  );
  return cachedLabel;
}

/**
 * Discriminated map of every Tauri event the frontend subscribes to.
 *
 * Field names MUST match exactly what Rust serializes (snake_case via serde).
 * Cross-checked against the canonical Rust emit sites:
 *   - src-tauri/src/watcher.rs:212 (FileChangeEvent), :219 (FolderChangeEvent),
 *     :313 (file-changed emit), :333-337 (folder-changed emit, per-window),
 *     :489-496 (kind classification: "content" | "review" | "deleted")
 *   - src-tauri/src/commands/sidecar_config.rs:64-66 (folder-changed broadcast emit)
 *   - src-tauri/src/commands/comments/mod.rs:34 (CommentsChangedEvent),
 *     :90-95 (comments-changed app-wide emit)
 *   - src-tauri/src/update.rs (update-progress)
 *   - src-tauri/src/lib.rs (menu-* and second-instance args-received)
 *
 * Tests constructing these payloads MUST use the shared factories at
 * `src/__tests__/fixtures/ipc-event-fixtures.ts` — see rule 26 in
 * `docs/test-strategy.md`.
 */
export interface EventPayloads {
  "file-changed": { path: string; kind: "content" | "review" | "deleted" };
  "folder-changed": { path: string };
  "comments-changed": { file_path: string };
  // Signal-only: payload is intentionally empty. Frontend MUST call
  // `get_launch_args` to drain the queued args. See useLaunchArgsBootstrap
  // and src-tauri/src/lib.rs (single-instance handler).
  "args-received": void;
  // Wire field on the Rust side is `String` (src-tauri/src/update.rs:23
  // `UpdateProgressEvent.event: String`), but the production emitter only
  // ever uses one of these three literal values (update.rs:108,110,119).
  // The TS type intentionally NARROWS to that union so a future Rust
  // addition (e.g. "Cancelled") fails type-check + parity test in this
  // PR — extending the literal set requires updating EventPayloads,
  // ipc-event-fixtures.ts, and the Rust serde JSON pin in update.rs in
  // the same change.
  "update-progress": {
    event: "Started" | "Progress" | "Finished";
    content_length: number | null;
    chunk_length: number;
  };
  // Emitted by the window registry when files should be opened as tabs in
  // this window (AddToWindow / CreateFileOnly). Payload is `Vec<PathBuf>`
  // serialized as `string[]`.
  "open-file-tab": string[];
  // Emitted by sidecar config commands after toggle/migration so the
  // watcher hook rescans ghost entries. Payload mirrors
  // src-tauri/src/watcher.rs::SidecarConfigChangedEvent.
  "sidecar-config-changed": { path: string };
  // Menu events — emitted from on_menu_event with `()` payload.
  "menu-open-file": void;
  "menu-open-folder": void;
  "menu-close-folder": void;
  "menu-close-tab": void;
  "menu-close-all-tabs": void;
  "menu-toggle-comments-pane": void;
  "menu-next-tab": void;
  "menu-prev-tab": void;
  "menu-theme-system": void;
  "menu-theme-light": void;
  "menu-theme-dark": void;
  "menu-about": void;
  "menu-check-updates": void;
  "menu-help-settings": void;
}

export type EventName = keyof EventPayloads;

/**
 * Subscribe to a typed Tauri event. The callback receives the deserialized
 * payload directly (no event wrapper). Returns an `UnlistenFn` promise that
 * callers must `.then(fn => fn()).catch(() => {})` in their effect cleanup.
 *
 * **Window-scoped by default.** All listeners register with
 * `target = WebviewWindow { label: <this-window-label> }` so Tauri's
 * `match_any_or_filter` (verified in `tauri::event::listener::match_any_or_filter`)
 * delivers `emit_to(label, …)` events ONLY to listeners whose label
 * matches the emit target — and `emit(…)` (broadcast) still fires
 * every listener because broadcasts pass `None` filter and `unwrap_or(true)`
 * matches every label. Without this scoping, the default
 * `EventTarget::Any` listener short-circuits the filter and EVERY
 * window receives EVERY `emit_to` — re-introducing the multi-window
 * broadcast bug at the listener layer (rule
 * `multiwin-window-scoped-events` in
 * `docs/best-practices-common/tauri/v2-patterns.md`).
 *
 * Logs each receive at debug level with the window label so a log
 * file from a multi-window session shows which window's listener
 * fired for every event.
 */
export function listenEvent<K extends EventName>(
  name: K,
  callback: (payload: EventPayloads[K]) => void,
): Promise<UnlistenFn> {
  const label = currentLabel();
  return listen<EventPayloads[K]>(
    name,
    (event) => {
      void debug(
        `[tauri-events] received event=${name} window-label=${label}`,
      );
      callback(event.payload);
    },
    { target: { kind: "WebviewWindow", label } },
  );
}
