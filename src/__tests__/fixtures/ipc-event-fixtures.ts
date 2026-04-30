/**
 * Shared test fixtures for IPC event payloads emitted from the Rust backend.
 *
 * Every factory returns the canonical `EventPayloads[K]` shape from
 * `@/lib/tauri-events`, which is hand-cross-checked against the Rust emit
 * sites cited in each factory's JSDoc. Tests MUST import from here instead
 * of constructing inline `{ path, kind }` / `{ file_path }` literals — see
 * rule 26 in `docs/test-strategy.md` and section 4 in
 * `docs/best-practices-project/test-patterns.md`.
 *
 * If you add a new IPC event in Rust, extend `EventPayloads` AND add a
 * factory here in the same PR. Drift between fixture and emit-site is a
 * rule-26 violation that the conformance scan
 * (`src/__tests__/ipc-event-fixture-conformance.test.ts`) will surface,
 * but humans should catch it first.
 */
import type { EventPayloads } from "@/lib/tauri-events";

export type FileChangedPayload = EventPayloads["file-changed"];
export type FolderChangedPayload = EventPayloads["folder-changed"];
export type CommentsChangedPayload = EventPayloads["comments-changed"];

/**
 * Canonical sample paths used by the fixtures and re-exported for tests
 * that need to assert against the same string the factory emits. Source
 * paths are plain `.md`; review-sidecar paths end with `.review.yaml` or
 * `.review.json` per the classification at
 * `src-tauri/src/watcher.rs:489-496`.
 */
export const ipcEventFixturePaths = {
  folder: "/workspace",
  source: "/workspace/notes.md",
  reviewYaml: "/workspace/notes.md.review.yaml",
  reviewJson: "/workspace/notes.md.review.json",
} as const;

/**
 * `file-changed` with `kind: "content"` — emitted when a non-sidecar file
 * (e.g. the markdown source) was modified. Payload struct:
 * `src-tauri/src/watcher.rs:212` (`FileChangeEvent { path, kind }`);
 * classification at `src-tauri/src/watcher.rs:489-496`; emit site at
 * `src-tauri/src/watcher.rs:313` (per-window via `emit_to`).
 */
export function fileChangedContent(
  path: string = ipcEventFixturePaths.source,
): FileChangedPayload {
  return { path, kind: "content" };
}

/**
 * `file-changed` with `kind: "review"` for a `.review.yaml` sidecar.
 * The path here is the *sidecar* path, NOT the source path — this is the
 * exact bug class iter-1/iter-3 of #298 hit (synthetic tests passed using
 * source paths; production silently no-opped because real watcher emits
 * sidecar paths). See `src-tauri/src/watcher.rs:489-496` for the
 * classification (path ending with `.review.yaml` ⇒ kind="review").
 * Emit site: `src-tauri/src/watcher.rs:313`.
 */
export function fileChangedReview(
  path: string = ipcEventFixturePaths.reviewYaml,
): FileChangedPayload {
  return { path, kind: "review" };
}

/**
 * `file-changed` with `kind: "review"` for a `.review.json` sidecar.
 * Same contract as `fileChangedReview` but with the `.json` variant; the
 * classification at `src-tauri/src/watcher.rs:489-496` accepts either
 * extension.
 */
export function fileChangedReviewJson(
  path: string = ipcEventFixturePaths.reviewJson,
): FileChangedPayload {
  return { path, kind: "review" };
}

/**
 * `file-changed` with `kind: "deleted"` — emitted when the file no longer
 * exists at the watched path (regardless of whether it's a source or a
 * review sidecar). See `src-tauri/src/watcher.rs:489-496` (`exists ==
 * false` branch). Emit site: `src-tauri/src/watcher.rs:313`.
 */
export function fileChangedDeleted(
  path: string = ipcEventFixturePaths.source,
): FileChangedPayload {
  return { path, kind: "deleted" };
}

/**
 * `folder-changed` — emitted when the listing of a watched directory
 * changed. Payload struct: `src-tauri/src/watcher.rs:219`
 * (`FolderChangeEvent { path }`). Per-window emit at
 * `src-tauri/src/watcher.rs:333-337`; broadcast (all windows) emit at
 * `src-tauri/src/commands/sidecar_config.rs:64-66` after sidecar-config
 * mutation. Same payload shape in both cases.
 */
export function folderChanged(
  path: string = ipcEventFixturePaths.folder,
): FolderChangedPayload {
  return { path };
}

/**
 * `comments-changed` — emitted app-wide after a comment-mutation command
 * modifies a sidecar. Payload struct:
 * `src-tauri/src/commands/comments/mod.rs:34`
 * (`CommentsChangedEvent { file_path: String }` — note `file_path` is
 * snake_case, matching Serde default). Emit site:
 * `src-tauri/src/commands/comments/mod.rs:90-95`. The carried path is
 * the SOURCE file path, not the sidecar — this is the contract producers
 * (commands) and consumers (`useComments`) agree on.
 */
export function commentsChanged(
  filePath: string = ipcEventFixturePaths.source,
): CommentsChangedPayload {
  return { file_path: filePath };
}
