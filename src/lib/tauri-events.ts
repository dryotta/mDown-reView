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
 * Cross-checked against:
 *   - src-tauri/src/watcher.rs (file-changed)
 *   - src-tauri/src/commands.rs (comments-changed, args-received)
 *   - src-tauri/src/update.rs (update-progress)
 *   - src-tauri/src/lib.rs (menu-* and second-instance args-received)
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
  "menu-help-welcome": void;
  "menu-help-setup": void;
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
