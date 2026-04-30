// Single chokepoint for ALL Tauri event listeners. Mirror of the IPC
// chokepoint in `@/lib/tauri-commands`. Production code outside this file
// MUST NOT import `@tauri-apps/api/event` directly — see
// `src/__tests__/event-chokepoint.test.ts` for the architectural assertion.

import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type { UnlistenFn };

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
 */
export function listenEvent<K extends EventName>(
  name: K,
  callback: (payload: EventPayloads[K]) => void,
): Promise<UnlistenFn> {
  return listen<EventPayloads[K]>(name, (event) => callback(event.payload));
}
