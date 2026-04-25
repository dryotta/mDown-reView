import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { warn } from "@/logger";
import { EXTERNAL_LINK_SCHEME, BLOCKED_LINK_SCHEME } from "@/lib/url-policy";

// ── Asset URL chokepoint ───────────────────────────────────────────────────
// All conversion of absolute filesystem paths to webview-loadable asset URLs
// MUST go through this wrapper. Do not import convertFileSrc directly outside
// of this module.
export const convertAssetUrl = (absolute: string): string => convertFileSrc(absolute);

// ── Shared interfaces ──────────────────────────────────────────────────────

export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

export interface LaunchArgs {
  files: string[];
  folders: string[];
}

// MRSF comment + anchor types live in `@/types/comments` (canonical home,
// added in iter 2 Group B). Re-exported here for back-compat with existing
// imports `from "@/lib/tauri-commands"`.
export type {
  Anchor,
  CsvCellAnchor,
  HtmlElementAnchor,
  HtmlRangeAnchor,
  ImageRectAnchor,
  JsonPathAnchor,
  MrsfComment,
  MrsfSidecar,
  Reaction,
  WordRangeAnchor,
} from "@/types/comments";
import type { MrsfComment } from "@/types/comments";
import type { Anchor } from "@/types/comments";

// ── Typed wrappers ─────────────────────────────────────────────────────────

export interface TextFileResult {
  content: string;
  size_bytes: number;
  line_count: number;
}

export const readTextFile = (path: string): Promise<TextFileResult> =>
  invoke<TextFileResult>("read_text_file", { path });

export const readBinaryFile = (path: string): Promise<string> =>
  invoke<string>("read_binary_file", { path });

export interface FileStat {
  size_bytes: number;
}

export const statFile = (path: string): Promise<FileStat> =>
  invoke<FileStat>("stat_file", { path });

// ── System integration: reveal in folder / open in default app ────────────
// Both commands are workspace-allowlisted in Rust (`commands/system.rs`):
// the path must be in an open tab or inside an open workspace folder.
// On rejection the IPC throws a `SystemError` discriminated by `kind`.

export type SystemError =
  | { kind: "PathOutsideWorkspace" }
  | { kind: "IoError"; message: string }
  | { kind: "Unsupported" };

export const revealInFolder = (path: string): Promise<void> =>
  invoke<void>("reveal_in_folder", { path });

export const openInDefaultApp = (path: string): Promise<void> =>
  invoke<void>("open_in_default_app", { path });

export const resolveHtmlAssets = (html: string, htmlDir: string): Promise<string> =>
  invoke<string>("resolve_html_assets", { html, htmlDir });

export const readDir = (path: string): Promise<DirEntry[]> =>
  invoke<DirEntry[]>("read_dir", { path });

export const getLaunchArgs = (): Promise<LaunchArgs> =>
  invoke<LaunchArgs>("get_launch_args");

export const getLogPath = (): Promise<string> =>
  invoke<string>("get_log_path");


export const updateWatchedFiles = (paths: string[]): Promise<void> =>
  invoke<void>("update_watched_files", { paths });

export const updateTreeWatchedDirs = (root: string, dirs: string[]): Promise<void> =>
  invoke<void>("update_tree_watched_dirs", { root, dirs });

export const scanReviewFiles = (root: string): Promise<[string, string][]> =>
  invoke<[string, string][]>("scan_review_files", { root });

export const checkPathExists = (path: string): Promise<"file" | "dir" | "missing"> =>
  invoke<"file" | "dir" | "missing">("check_path_exists", { path });


export const getAppVersion = (): Promise<string> => getVersion();

// ── Phase 2: MVVM domain commands ─────────────────────────────────────────

export interface MatchedComment extends MrsfComment {
  matchedLineNumber: number;
  isOrphaned: boolean;
  anchoredText?: string;
}

export interface CommentThread {
  root: MatchedComment;
  replies: MatchedComment[];
}

export interface CommentAnchor {
  line: number;
  end_line?: number;
  start_column?: number;
  end_column?: number;
  selected_text?: string;
  selected_text_hash?: string;
}

export const getFileComments = (filePath: string): Promise<CommentThread[]> =>
  invoke<CommentThread[]>("get_file_comments", { filePath });


export const addComment = (
  filePath: string,
  author: string,
  text: string,
  anchor?: CommentAnchor,
  commentType?: string,
  severity?: string,
  document?: string
): Promise<void> =>
  invoke<void>("add_comment", {
    filePath,
    author,
    text,
    anchor: anchor ?? null,
    commentType: commentType ?? null,
    severity: severity ?? null,
    document: document ?? null,
  });

export const addReply = (
  filePath: string,
  parentId: string,
  author: string,
  text: string
): Promise<void> =>
  invoke<void>("add_reply", { filePath, parentId, author, text });

export const editComment = (
  filePath: string,
  commentId: string,
  text: string
): Promise<void> =>
  invoke<void>("edit_comment", { filePath, commentId, text });

export const deleteComment = (
  filePath: string,
  commentId: string
): Promise<void> =>
  invoke<void>("delete_comment", { filePath, commentId });

export const computeAnchorHash = (text: string): Promise<string> =>
  invoke<string>("compute_anchor_hash", { text });

// ── Iter 1 / F0 — new IPC surface (advisory #2/3) ────────────────────────

/** Total order of comment severity. Mirrors `core::severity::Severity`. */
export type Severity = "none" | "low" | "medium" | "high";

/** Per-file badge payload returned by `get_file_badges` (count + worst severity). */
export interface FileBadge {
  count: number;
  max_severity: Severity;
}

/**
 * Discriminated patch payload for `update_comment`. Kinds mirror the Rust
 * `CommentPatch` enum (snake_case). Adding a new patch variant requires
 * editing both this union and `commands/comments/update.rs`.
 */
export type CommentPatch =
  | { kind: "add_reaction"; data: { user: string; kind: string; ts: string } }
  | { kind: "set_resolved"; data: { resolved: boolean } }
  | { kind: "move_anchor"; data: { new_anchor: Anchor } };

/** Apply a discriminated patch to a single comment. */
export const updateComment = (
  filePath: string,
  commentId: string,
  patch: CommentPatch,
): Promise<void> =>
  invoke<void>("update_comment", { filePath, commentId, patch });

/** Per-file unresolved-thread count + worst severity. */
export const getFileBadges = (
  filePaths: string[],
): Promise<Record<string, FileBadge>> =>
  invoke<Record<string, FileBadge>>("get_file_badges", { filePaths });

/** Render a markdown digest of every thread under `workspace`. */
export const exportReviewSummary = (workspace: string): Promise<string> =>
  invoke<string>("export_review_summary", { workspace });

/** Discriminated error from `set_author`. */
export type ConfigError =
  | { kind: "InvalidAuthor"; reason: "empty" | "too_long" | "newline" | "control_char" }
  | { kind: "IoError"; message: string };

/** Persist the display name written into `MrsfComment.author`. Returns the
 *  trimmed value on success; throws a typed `ConfigError` on validation /
 *  persistence failure. */
export const setAuthor = (name: string): Promise<string> =>
  invoke<string>("set_author", { name });

/** Read the persisted display name. Falls back to the OS user (USERNAME /
 *  USER env var) and finally to `"anonymous"` on the Rust side — never
 *  rejects on validation. */
export const getAuthor = (): Promise<string> => invoke<string>("get_author");

// ── Document search ──────────────────────────────────────────────────────

export interface SearchMatch {
  lineIndex: number;
  startCol: number;
  endCol: number;
}

export const searchInDocument = (content: string, query: string): Promise<SearchMatch[]> =>
  invoke<SearchMatch[]>("search_in_document", { content, query });

// ── Pure parsers (Rust core) ─────────────────────────────────────────────

export interface FoldRegion {
  startLine: number;
  endLine: number;
}

export const computeFoldRegions = (content: string, language: string): Promise<FoldRegion[]> =>
  invoke<FoldRegion[]>("compute_fold_regions", { content, language });

export interface KqlPipelineStep {
  step: number;
  operator: string;
  details: string;
  isSource: boolean;
}

export const parseKql = (query: string): Promise<KqlPipelineStep[]> =>
  invoke<KqlPipelineStep[]>("parse_kql", { query });

export const stripJsonComments = (text: string): Promise<string> =>
  invoke<string>("strip_json_comments", { text });

// ── UAX #29 word tokeniser (Rust core, used by WordRange anchor) ─────────
//
// Single source of truth for word-stream offsets shared between the
// renderer (selection/highlight) and the Rust matcher (anchor resolution).
// Byte offsets are into the original UTF-8 input.

export interface WordSpan {
  start: number;
  end: number;
  text: string;
}

export const tokenizeWords = (text: string): Promise<WordSpan[]> =>
  invoke<WordSpan[]>("tokenize_words", { text });

// ── Remote asset fetcher (bounded HTTPS image proxy) ─────────────────────
// Renderer hands a remote URL to Rust; Rust returns a single binary blob
// (`tauri::ipc::Response`) so the payload bytes do NOT bloat through JSON
// number-array encoding (~3-4× per byte). Wire format:
//   [u32 BE: ct_len][ct_bytes (UTF-8 mime)][payload bytes]
// Frontend converts payload → blob URL so the CSP `img-src` stays locked.
// Bounds enforced in Rust (`commands/remote_asset.rs`): https-only, 8 MB
// cap, 10 s timeout, image/* content-type allowlist, status 200, redirects
// capped at 5 hops + https-only-per-hop, semaphore-capped concurrency.

export interface RemoteAssetResponse {
  bytes: Uint8Array;
  contentType: string;
}

export async function fetchRemoteAsset(url: string): Promise<RemoteAssetResponse> {
  const ab = await invoke<ArrayBuffer>("fetch_remote_asset", { url });
  // Defensive parse — a malformed (e.g. < 4 byte) blob would otherwise throw
  // an opaque DataView range error.
  if (ab.byteLength < 4) throw new Error("fetch_remote_asset: response too short");
  const view = new DataView(ab);
  const ctLen = view.getUint32(0, false); // big-endian
  if (4 + ctLen > ab.byteLength) {
    throw new Error("fetch_remote_asset: content-type length out of range");
  }
  const ctBytes = new Uint8Array(ab, 4, ctLen);
  const contentType = new TextDecoder().decode(ctBytes);
  const bytes = new Uint8Array(ab, 4 + ctLen);
  return { bytes, contentType };
}

// ── Update channel commands ───────────────────────────────────────────────

export interface UpdateInfo {
  version: string;
  body: string | null;
}

export const checkUpdate = (channel: string): Promise<UpdateInfo | null> =>
  invoke<UpdateInfo | null>("check_update", { channel });

export const installUpdate = (): Promise<void> =>
  invoke<void>("install_update");

// ── Dialog wrapper ────────────────────────────────────────────────────────

export interface OpenDialogOptions {
  directory?: boolean;
  multiple?: boolean;
  title?: string;
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
}

export const showOpenDialog = async (
  options: OpenDialogOptions = {}
): Promise<string | string[] | null> => {
  const { open } = await import("@tauri-apps/plugin-dialog");
  return open(options);
};

// ── Plugin wrappers ──────────────────────────────────────────────────────

export const copyToClipboard = (text: string): Promise<void> => {
  return import("@tauri-apps/plugin-clipboard-manager").then((m) => m.writeText(text));
};

// Defense-in-depth: enforce a scheme allowlist before delegating to the OS
// opener. Acceptable: http(s), mailto, tel. Everything else (and notably
// javascript:/file:/data:/vbscript:) is rejected with a logged warning.
// Scheme regexes are shared with viewer link handlers via `@/lib/url-policy`.

export const openExternalUrl = (url: string): Promise<void> => {
  if (BLOCKED_LINK_SCHEME.test(url) || !EXTERNAL_LINK_SCHEME.test(url)) {
    warn(`openExternalUrl: blocked URL scheme: ${url}`);
    return Promise.reject(new Error(`Blocked URL scheme: ${url}`));
  }
  return import("@tauri-apps/plugin-opener").then((m) => m.openUrl(url));
};

export const restartApp = (): Promise<void> => {
  return import("@tauri-apps/plugin-process").then((m) => m.relaunch());
};

// ── Onboarding & platform integration commands ───────────────────────────

export interface OnboardingState {
  schema_version: number;
  last_welcomed_version: string | null;
  last_seen_sections: string[];
}

export type CliShimStatus = "done" | "missing" | "broken" | "unsupported";
export type CliShimError =
  | { kind: "permission_denied"; path: string; target: string }
  | { kind: "io"; message: string };
export type DefaultHandlerStatus = "done" | "other" | "unknown" | "unsupported";
export type FolderContextStatus = "done" | "missing" | "unsupported";

export const onboardingState = (): Promise<OnboardingState> =>
  invoke<OnboardingState>("onboarding_state");

export const onboardingMarkWelcomed = (version: string): Promise<void> =>
  invoke<void>("onboarding_mark_welcomed", { version });

export const onboardingShouldWelcome = (): Promise<boolean> =>
  invoke<boolean>("onboarding_should_welcome");

export const cliShimStatus = (): Promise<CliShimStatus> =>
  invoke<CliShimStatus>("cli_shim_status");

export const installCliShim = (): Promise<void> =>
  invoke<void>("install_cli_shim");

export const removeCliShim = (): Promise<void> =>
  invoke<void>("remove_cli_shim");

export const defaultHandlerStatus = (): Promise<DefaultHandlerStatus> =>
  invoke<DefaultHandlerStatus>("default_handler_status");

export const setDefaultHandler = (): Promise<void> =>
  invoke<void>("set_default_handler");

export const folderContextStatus = (): Promise<FolderContextStatus> =>
  invoke<FolderContextStatus>("folder_context_status");

export const registerFolderContext = (): Promise<void> =>
  invoke<void>("register_folder_context");

export const unregisterFolderContext = (): Promise<void> =>
  invoke<void>("unregister_folder_context");

