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
export type UpdateProgressPayload = EventPayloads["update-progress"];

/**
 * Canonical sample paths used by the fixtures and re-exported for tests
 * that need to assert against the same string the factory emits. Source
 * paths are plain `.md`; review-sidecar paths end with `.review.yaml` or
 * `.review.json` per the classification at
 * `src-tauri/src/watcher.rs:489-496`.
 */
/**
 * Throws if `path` looks like a review sidecar. Used by factories whose
 * production emit-site (the watcher's classification at
 * `src-tauri/src/watcher.rs:489-496`, or the comment producers at
 * `src-tauri/src/commands/comments/mod.rs:90-95`) would never carry a
 * sidecar path under that event/kind. Catches the iter-1/iter-3 #298 bug
 * class (and its #311 recurrence path) at fixture-construction time.
 */
function assertNonSidecarPath(path: string, factory: string): void {
  if (path.endsWith(".review.yaml") || path.endsWith(".review.json")) {
    throw new Error(
      `${factory}: path "${path}" looks like a sidecar (.review.yaml/.review.json), ` +
        `but the production watcher would never emit this kind for a sidecar path. ` +
        `See src-tauri/src/watcher.rs:489-496 (kind classification). ` +
        `Use fileChangedReview() or fileChangedReviewJson() instead.`,
    );
  }
}

/**
 * Throws if `path` is not a review sidecar (or, when `expectedSuffix` is
 * provided, not the specific sidecar variant). Mirrors the
 * `path.ends_with(".review.yaml")` / `path.ends_with(".review.json")`
 * arms of the watcher classification at
 * `src-tauri/src/watcher.rs:489-496`.
 */
function assertSidecarPath(
  path: string,
  factory: string,
  expectedSuffix?: ".review.yaml" | ".review.json",
): void {
  const isSidecar = expectedSuffix
    ? path.endsWith(expectedSuffix)
    : path.endsWith(".review.yaml") || path.endsWith(".review.json");
  if (!isSidecar) {
    throw new Error(
      `${factory}: path "${path}" is not a sidecar path` +
        (expectedSuffix
          ? ` (must end with ${expectedSuffix}). `
          : ` (must end with .review.yaml or .review.json). `) +
        `The production watcher only emits kind="review" for sidecar paths. ` +
        `See src-tauri/src/watcher.rs:489-496 (kind classification).`,
    );
  }
}

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
 *
 * **Validation:** throws if `path` ends with `.review.yaml` or
 * `.review.json` — the real watcher would have classified it as
 * `kind="review"`, not `"content"`.
 */
export function fileChangedContent(
  path: string = ipcEventFixturePaths.source,
): FileChangedPayload {
  assertNonSidecarPath(path, "fileChangedContent");
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
 *
 * **Validation:** throws if `path` does not end with `.review.yaml` or
 * `.review.json` — anything else would have been classified as
 * `kind="content"` by the watcher.
 */
export function fileChangedReview(
  path: string = ipcEventFixturePaths.reviewYaml,
): FileChangedPayload {
  assertSidecarPath(path, "fileChangedReview");
  return { path, kind: "review" };
}

/**
 * `file-changed` with `kind: "review"` for a `.review.json` sidecar.
 * Same contract as `fileChangedReview` but with the `.json` variant; the
 * classification at `src-tauri/src/watcher.rs:489-496` accepts either
 * extension.
 *
 * **Validation:** throws if `path` does not end with `.review.json`.
 */
export function fileChangedReviewJson(
  path: string = ipcEventFixturePaths.reviewJson,
): FileChangedPayload {
  assertSidecarPath(path, "fileChangedReviewJson", ".review.json");
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
 *
 * **Validation:** throws if `filePath` ends with `.review.yaml` or
 * `.review.json` — producers always emit the SOURCE path, never the
 * sidecar path.
 */
export function commentsChanged(
  filePath: string = ipcEventFixturePaths.source,
): CommentsChangedPayload {
  if (filePath.endsWith(".review.yaml") || filePath.endsWith(".review.json")) {
    throw new Error(
      `commentsChanged: filePath "${filePath}" looks like a sidecar (.review.yaml/.review.json), ` +
        `but production producers always emit the source file path. ` +
        `See src-tauri/src/commands/comments/mod.rs:90-95.`,
    );
  }
  return { file_path: filePath };
}

/**
 * `update-progress` — emitted app-wide during updater download/install.
 * Payload struct: `src-tauri/src/update.rs:21-26`
 * (`UpdateProgressEvent { event: String, content_length: Option<u64>, chunk_length: usize }`).
 * Emit sites: `src-tauri/src/update.rs:115` (chunk callback — Started/Progress)
 * and `src-tauri/src/update.rs:123` (finish callback — Finished).
 *
 * The `event` field on the wire is `String`, but the production
 * emitter only ever uses one of three literal strings (`"Started"`,
 * `"Progress"`, `"Finished"` at `update.rs:108,110,119`). The
 * `EventPayloads["update-progress"]` type narrows it to the union
 * accordingly, and this fixture validates the input.
 */
function assertValidUpdateProgressEvent(event: string, factory: string): void {
  if (event !== "Started" && event !== "Progress" && event !== "Finished") {
    throw new Error(
      `${factory}: event "${event}" is not one of the production-emittable values ` +
        `("Started" | "Progress" | "Finished"). See src-tauri/src/update.rs:108,110,119.`,
    );
  }
}

function assertValidNumericField(
  name: string,
  value: number,
  factory: string,
): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `${factory}: ${name}=${value} is not a finite non-negative integer. ` +
        `Production Rust types are usize/Option<u64> at src-tauri/src/update.rs:21-26 ` +
        `and cannot represent negatives or Infinity.`,
    );
  }
}

function assertValidUpdateProgressShape(
  p: UpdateProgressPayload,
  factory: string,
): void {
  // Numeric domain.
  assertValidNumericField("chunk_length", p.chunk_length, factory);
  if (p.content_length !== null) {
    assertValidNumericField("content_length", p.content_length, factory);
  }

  // Cross-field constraints from src-tauri/src/update.rs:107-114, 117-122:
  //   Started   ⇔ content_length !== null AND chunk_length === 0
  //   Finished  ⇔ content_length === null AND chunk_length === 0
  //   Progress  ⇔ NOT a Started-shaped payload (Rust's else branch)
  if (p.event === "Started") {
    if (p.content_length === null) {
      throw new Error(
        `${factory}: event="Started" requires content_length !== null ` +
          `(Rust emit at src-tauri/src/update.rs:107-114 only emits Started when ` +
          `content_length.is_some()).`,
      );
    }
    if (p.chunk_length !== 0) {
      throw new Error(
        `${factory}: event="Started" requires chunk_length === 0 ` +
          `(Rust emit at src-tauri/src/update.rs:107-114 only emits Started when ` +
          `chunk_length == 0).`,
      );
    }
  } else if (p.event === "Finished") {
    if (p.content_length !== null) {
      throw new Error(
        `${factory}: event="Finished" requires content_length === null ` +
          `(Rust emit at src-tauri/src/update.rs:117-122 always sets content_length: None).`,
      );
    }
    if (p.chunk_length !== 0) {
      throw new Error(
        `${factory}: event="Finished" requires chunk_length === 0 ` +
          `(Rust emit at src-tauri/src/update.rs:117-122 always sets chunk_length: 0).`,
      );
    }
  } else if (p.event === "Progress") {
    // Progress is the Rust else-branch — anything not matching Started's shape
    // is valid. Reject Started-shaped payloads marked as Progress to catch typos.
    if (p.content_length !== null && p.chunk_length === 0) {
      throw new Error(
        `${factory}: event="Progress" with content_length !== null AND chunk_length === 0 ` +
          `is impossible — Rust at src-tauri/src/update.rs:107-114 would have classified this as "Started".`,
      );
    }
  }
}

export function updateProgress(
  o: Partial<UpdateProgressPayload> = {},
): UpdateProgressPayload {
  const event = o.event ?? "Progress";
  assertValidUpdateProgressEvent(event, "updateProgress");
  const payload: UpdateProgressPayload = {
    event,
    content_length: o.content_length ?? null,
    chunk_length: o.chunk_length ?? 0,
  };
  assertValidUpdateProgressShape(payload, "updateProgress");
  return payload;
}
