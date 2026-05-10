// Single chokepoint for ALL Tauri event listeners. Mirror of the IPC
// chokepoint in `@/lib/tauri-commands`. Production code outside this file
// MUST NOT import `@tauri-apps/api/event` directly — see
// `src/__tests__/event-chokepoint.test.ts` for the architectural assertion.

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWebview } from "@tauri-apps/api/webview";
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
  /**
   * Issue #352 / iter-12 — pre-close flush handshake (renamed in
   * iter-16 from `excalidraw-flush-before-close` to the generic
   * `flush-before-close`). Emitted by Rust on
   * `WindowEvent::CloseRequested` (after `prevent_close`); renderer
   * drains all registered pending flushes and acks via the
   * `close_flush_complete` IPC. Payload is the window label so a
   * multi-window setup ack-es the correct close path. See
   * `src-tauri/src/commands/close_flush.rs` and
   * `src/hooks/useExcalidrawCloseFlush.ts`.
   */
  "flush-before-close": string;
  /**
   * Issue #352 / iter-15 — multi-window file singleton (focus-existing).
   * Emitted by Rust's `claim_open_file` to the OWNING window when a
   * different window tries to open a file already claimed there.
   * Payload is the path string. Renderer hook
   * `useFocusTab` listens and calls `setActiveTab(path)`. Rust ALSO
   * focuses the owner window via `focus_window`
   * (un-minimize → show → set-focus) before emitting, so the owner's
   * window comes to the front even when minimized / hidden.
   */
  "focus-tab": string;
  /**
   * PR #372 — drag-drop classification rejected the entire drop
   * because no path resolved to a usable file or folder (deleted,
   * renamed, broken symlink, NTFS-ADS, etc.). Emitted by
   * `commands::drag_drop::handle_dropped_paths` so the renderer can
   * surface a transient toast — without it the overlay just hides
   * on Drop and the user sees no explanation
   * (bug-expert PR #372 #2 / product-expert #9).
   */
  "drag-drop-rejected": { count: number; reason: string };
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
 * `.claude/agents/tauri-coding-expert/knowledge/tauri-v2-patterns.md`).
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

/**
 * Webview-level drag-drop event payload, re-exported from
 * `@tauri-apps/api/webview` so production code touches the upstream
 * type — never a hand-rolled clone — and any future Tauri renaming of
 * a discriminator (e.g. `type: "drop"` → `type: "dropped"`) breaks
 * compilation here, not silently in production. Citation: see
 * `@tauri-apps/api/webview` `DragDropEvent` (re-exported alongside
 * `onDragDropEvent`'s `EventCallback<DragDropEvent>` signature).
 */
export type { DragDropEvent } from "@tauri-apps/api/webview";

/**
 * Subscribe to webview drag-drop events for the current window.
 *
 * The actual file-open work happens **in Rust**: WebView2 / WKWebView's
 * native DnD delivers the OS file paths to `WindowEvent::DragDrop`,
 * which `commands::drag_drop::handle_dropped_paths` funnels through
 * `route_args_through_registry` — identical semantics to CLI launch,
 * single-instance forwarding, and macOS `RunEvent::Opened`. This
 * JS-side listener is for **visual feedback only** (overlay show/hide).
 *
 * Per `mac-webview-drag-drop` rule in
 * `docs/best-practices-common/tauri/macos-platform.md`, handling
 * drops on the Rust side avoids WKWebView's unreliable HTML5
 * `drop`-event propagation.
 *
 * Routed through this chokepoint so `getCurrentWebview` is imported
 * in exactly one production file (mirrors `listenEvent`'s discipline
 * for `@tauri-apps/api/event`); enforced by
 * `src/__tests__/event-chokepoint.test.ts`.
 *
 * `over` events fire continuously during drag (mouse-move cadence) so
 * are NOT logged — only state-changing transitions (`enter`, `drop`,
 * `leave`). Otherwise the rotating log file fills with hundreds of
 * lines per drag, drowning useful signal.
 */
export function listenDragDrop(
  callback: (payload: import("@tauri-apps/api/webview").DragDropEvent) => void,
): Promise<UnlistenFn> {
  const label = currentLabel();
  return getCurrentWebview().onDragDropEvent((event) => {
    if (event.payload.type !== "over") {
      void debug(
        `[tauri-events] received drag-drop type=${event.payload.type} window-label=${label}`,
      );
    }
    callback(event.payload);
  });
}
