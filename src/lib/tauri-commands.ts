// Façade over the auto-generated `@/lib/bindings.ts` (tauri-specta). Every
// typed Tauri command wrapper this module exports is a thin pass-through
// that:
//   1. delegates to `commands.<camelCaseName>(...)` from `bindings.ts`,
//   2. unwraps the `Result<T, E>` discriminated union into a `Promise<T>`
//      that throws on error — matching the pre-rewrite contract that
//      every consumer in this codebase already expects.
//
// Why this layer exists at all
// ────────────────────────────
// `bindings.ts` is auto-generated and changes shape whenever a Rust
// command's signature changes. Routing every consumer through this façade
// gives us:
//   - One file to update when we want to rename a wrapper, change the
//     unwrap policy, or add cross-cutting logging.
//   - A stable home for IPC helpers that bindings.ts cannot describe
//     (binary-IPC `fetch_remote_asset`, plugin trampolines, asset-URL
//     conversion). These are listed at the bottom under "non-IPC helpers".
//   - The single-IPC-chokepoint rule (`docs/architecture.md` rule 1) is
//     preserved at the file pair: `tauri-commands.ts` + `bindings.ts`
//     together form the chokepoint. No production code outside this pair
//     imports `invoke`/`Channel`/`event` from `@tauri-apps/api/core`. The
//     `eslint-rules/no-direct-invoke.js` allowlist enforces this.

import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { warn } from "@/logger";
import { EXTERNAL_LINK_SCHEME, BLOCKED_LINK_SCHEME } from "@/lib/url-policy";
import { commands as bindings, type Result } from "@/lib/bindings";

// ── Result unwrap chokepoint ───────────────────────────────────────────────
// Bindings return `Result<T, E>` (tagged `{status: "ok", data} | {status:
// "error", error}`). Every façade wrapper passes the bindings call through
// `unwrap` so callers see the legacy throws-on-error contract.
//
// Error normalisation: typed payloads (e.g. `ConfigError`, `CliShimError`,
// `SystemError`) survive intact — we re-throw them verbatim so consumers
// can `catch (e: ConfigError)` and branch on `e.kind` without parsing
// strings. String errors are wrapped in `Error` for stack traces.
function unwrap<T, E>(p: Promise<Result<T, E>>): Promise<T> {
  return p.then((r) => {
    if (r.status === "ok") return r.data;
    const err = r.error;
    if (typeof err === "string") throw new Error(err);
    throw err;
  });
}

// ── Re-exports of bindings types ───────────────────────────────────────────
// Surface the same type names the codebase already imports from
// `@/lib/tauri-commands`. Adding a new bindings type to this list keeps the
// façade as the canonical TS-side import root so consumers don't need to
// reach into `@/lib/bindings` directly. (They CAN — bindings is a public
// module — but the convention is "consumers import from tauri-commands,
// chokepoint maintainers import from bindings".)

export type {
  CliShimError,
  CliShimStatus,
  CommentAnchor,
  CommentPatch,
  CommentThread,
  ConfigError,
  CsvCellAnchor,
  DefaultHandlerStatus,
  DirEntry,
  FileBadge,
  FileStat,
  FileViewerPref,
  FoldRegion,
  GetFileCommentsResult,
  HtmlElementAnchor,
  HtmlRangeAnchor,
  ImageRectAnchor,
  JsonPathAnchor,
  KqlPipelineStep,
  LaunchArgs,
  MatchedComment,
  MigrateDirection,
  MigrateSidecarsResult,
  NewCommentAnchor,
  OnboardingState,
  Reaction,
  ReadDirResult,
  SearchMatch,
  Severity,
  SidecarConfigResult,
  StartupPhase,
  SystemError,
  TaggedNewAnchor,
  TextFileResult,
  UpdateInfo,
  WordRangePayload,
  WordSpan,
} from "@/lib/bindings";

// In-memory tagged anchor + sidecar/comment shapes + helpers. These come
// from `@/lib/anchor-derive` (the post-IPC adapter layer), NOT from
// bindings — `bindings.ts`'s `Anchor` is the wire shape. See
// `src/lib/anchor-derive.ts` for the divergence rationale.
export type { Anchor, MrsfComment, MrsfSidecar, WordRangeAnchor } from "@/lib/anchor-derive";

// ── Asset URL chokepoint ───────────────────────────────────────────────────
// All conversion of absolute filesystem paths to webview-loadable asset URLs
// MUST go through this wrapper. Do not import convertFileSrc directly outside
// of this module.
export const convertAssetUrl = (absolute: string): string => convertFileSrc(absolute);

// ── Typed command wrappers (delegated to bindings) ─────────────────────────

import type {
  CommentAnchor,
  CommentPatch,
  FileBadge,
  FileStat,
  FileViewerPref,
  FoldRegion,
  GetFileCommentsResult,
  KqlPipelineStep,
  LaunchArgs,
  MigrateDirection,
  MigrateSidecarsResult,
  NewCommentAnchor,
  OnboardingState,
  PathKind,
  ReadDirResult,
  SearchMatch,
  SidecarConfigResult,
  StartupPhase,
  TextFileResult,
  UpdateInfo,
  WordSpan,
  CliShimStatus,
  DefaultHandlerStatus,
} from "@/lib/bindings";
import type { Anchor } from "@/lib/anchor-derive";

// File-system commands ──────────────────────────────────────────────────────

export const readTextFile = (path: string): Promise<TextFileResult> =>
  unwrap(bindings.readTextFile(path));

export const readBinaryFile = (path: string): Promise<string> =>
  unwrap(bindings.readBinaryFile(path));

export const statFile = (path: string): Promise<FileStat> => unwrap(bindings.statFile(path));

export const readDir = (
  path: string,
  limit?: number,
  showSidecars?: boolean
): Promise<ReadDirResult> => unwrap(bindings.readDir(path, limit ?? null, showSidecars ?? null));

export const checkPathExists = (path: string): Promise<PathKind> => bindings.checkPathExists(path);

export const canonicalizePath = (path: string): Promise<string> =>
  unwrap(bindings.canonicalizePath(path));

// System integration ──────────────────────────────────────────────────────

export const revealInFolder = (path: string): Promise<void> =>
  unwrap(bindings.revealInFolder(path)).then(() => {
    /* discard `null` data */
  });

// HTML asset inliner — Rust returns a bare string (no Result wrapper).
export const resolveHtmlAssets = (html: string, htmlDir: string): Promise<string> =>
  bindings.resolveHtmlAssets(html, htmlDir);

// Launch / log / scan ──────────────────────────────────────────────────────

export const getLaunchArgs = (): Promise<LaunchArgs> => unwrap(bindings.getLaunchArgs());

export const getLogPath = (): Promise<string> => unwrap(bindings.getLogPath());

export const updateWatchedFiles = (paths: string[]): Promise<void> =>
  unwrap(bindings.updateWatchedFiles(paths)).then(() => {});

export const updateTreeWatchedDirs = (root: string, dirs: string[]): Promise<void> =>
  unwrap(bindings.updateTreeWatchedDirs(root, dirs)).then(() => {});

export const scanReviewFiles = (root: string): Promise<[string, string][]> =>
  unwrap(bindings.scanReviewFiles(root));

// MVVM domain commands (comments) ──────────────────────────────────────────

export const getFileComments = (filePath: string): Promise<GetFileCommentsResult> =>
  unwrap(bindings.getFileComments(filePath));

export const addComment = (
  filePath: string,
  author: string,
  text: string,
  anchor?: CommentAnchor | Anchor,
  commentType?: string,
  severity?: string,
  document?: string
): Promise<void> =>
  unwrap(
    bindings.addComment(
      filePath,
      author,
      text,
      // `Anchor` (in-memory tagged) is structurally compatible with the
      // wire-shape `NewCommentAnchor` (which accepts both the tagged
      // `{kind, ...}` and the legacy flat `{line, ...}`). Cast through
      // unknown so TS doesn't reject the union widening.
      (anchor ?? null) as NewCommentAnchor | null,
      commentType ?? null,
      severity ?? null,
      document ?? null
    )
  ).then(() => {});

export const addReply = (
  filePath: string,
  parentId: string,
  author: string,
  text: string
): Promise<void> => unwrap(bindings.addReply(filePath, parentId, author, text)).then(() => {});

export const editComment = (filePath: string, commentId: string, text: string): Promise<void> =>
  unwrap(bindings.editComment(filePath, commentId, text)).then(() => {});

export const deleteComment = (filePath: string, commentId: string): Promise<void> =>
  unwrap(bindings.deleteComment(filePath, commentId)).then(() => {});

export const computeAnchorHash = (text: string): Promise<string> =>
  bindings.computeAnchorHash(text);

export const updateComment = (
  filePath: string,
  commentId: string,
  patch: CommentPatch
): Promise<void> => unwrap(bindings.updateComment(filePath, commentId, patch)).then(() => {});

export const getFileBadges = (filePaths: string[]): Promise<Record<string, FileBadge>> =>
  // bindings models the result as `Partial<{ [key in string]: FileBadge }>`
  // (Rust `HashMap<String, FileBadge>`); coerce to the tighter
  // `Record<string, FileBadge>` shape consumers already use.
  unwrap(bindings.getFileBadges(filePaths)) as Promise<Record<string, FileBadge>>;

// Author / config ──────────────────────────────────────────────────────────

export const setAuthor = (name: string): Promise<string> => unwrap(bindings.setAuthor(name));

export const getAuthor = (): Promise<string> => unwrap(bindings.getAuthor());

// Document search / parsers ────────────────────────────────────────────────

export const searchInDocument = (content: string, query: string): Promise<SearchMatch[]> =>
  bindings.searchInDocument(content, query);

export const computeFoldRegions = (content: string, language: string): Promise<FoldRegion[]> =>
  bindings.computeFoldRegions(content, language);

export const parseKql = (query: string): Promise<KqlPipelineStep[]> => bindings.parseKql(query);

export const stripJsonComments = (text: string): Promise<string> =>
  bindings.stripJsonComments(text);

export const tokenizeWords = (text: string): Promise<WordSpan[]> =>
  unwrap(bindings.tokenizeWords(text));

// Sidecar config ──────────────────────────────────────────────────────────

export const getSidecarConfig = (root: string): Promise<SidecarConfigResult> =>
  unwrap(bindings.getSidecarConfig(root));

export const setSidecarConfig = (root: string, enabled: boolean): Promise<SidecarConfigResult> =>
  unwrap(bindings.setSidecarConfig(root, enabled));

export const migrateSidecars = (
  root: string,
  direction: MigrateDirection
): Promise<MigrateSidecarsResult> => unwrap(bindings.migrateSidecarsCmd(root, direction));

// Update channel ──────────────────────────────────────────────────────────

export const checkUpdate = (channel: string): Promise<UpdateInfo | null> =>
  unwrap(bindings.checkUpdate(channel));

export const installUpdate = (): Promise<void> => unwrap(bindings.installUpdate()).then(() => {});

// Onboarding & platform integration ──────────────────────────────────────

export const onboardingState = (): Promise<OnboardingState> => unwrap(bindings.onboardingState());

export const cliShimStatus = (): Promise<CliShimStatus> => bindings.cliShimStatus();

export const installCliShim = (): Promise<void> => unwrap(bindings.installCliShim()).then(() => {});

export const removeCliShim = (): Promise<void> => unwrap(bindings.removeCliShim()).then(() => {});

export const defaultHandlerStatus = (): Promise<DefaultHandlerStatus> =>
  bindings.defaultHandlerStatus();

export const setDefaultHandler = (): Promise<void> =>
  unwrap(bindings.setDefaultHandler()).then(() => {});

// Per-file viewer prefs ──────────────────────────────────────────────────

export const getFileViewerPref = (path: string): Promise<FileViewerPref | null> =>
  bindings.getFileViewerPref(path);

export const setFileViewerPref = (path: string, allowImages: boolean): Promise<void> =>
  unwrap(bindings.setFileViewerPref(path, allowImages)).then(() => {});

// Window registry sync ────────────────────────────────────────────────────

export const registerWindowFolder = (folder: string): Promise<void> =>
  unwrap(bindings.registerWindowFolder(folder)).then(() => {});

export const unregisterWindowFolder = (): Promise<void> =>
  unwrap(bindings.unregisterWindowFolder()).then(() => {});

// Startup-phase telemetry (issue #264) ────────────────────────────────────
// The frontend reports the phases it owns — `theme-applied`,
// `frontend-mounted`, `first-file-loaded` — by name. Rust dedupes by
// phase per-process, so a chatty caller (StrictMode double-invoke,
// hot reload) cannot inflate the timeline. The recorder emits
// `[startup] phase=… t_ms=…` to the rotating log file. See
// `docs/observability.md` for the post-hoc analysis story.
export const recordStartupPhase = (phase: StartupPhase): Promise<void> =>
  bindings.recordStartupPhase(phase);

// ── Non-IPC helpers (cannot route through bindings) ───────────────────────
//
// The wrappers below are NOT part of the bindings.ts surface because either:
//   - the IPC payload is binary (specta doesn't describe `tauri::ipc::Response`);
//   - the function trampolines through a Tauri plugin (dialog, clipboard,
//     opener, process) loaded dynamically; or
//   - it consumes a pure JS API (`getVersion` from `@tauri-apps/api/app`).
// The single-chokepoint rule is preserved at the file level — the
// `eslint-rules/no-direct-invoke.js` allowlist exempts both
// `tauri-commands.ts` and `bindings.ts`.

// Remote asset fetcher (bounded HTTPS image proxy) — binary IPC ────────────
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

// Dialog wrapper (plugin trampoline) ──────────────────────────────────────

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

// Clipboard / process plugins ─────────────────────────────────────────────

export const copyToClipboard = (text: string): Promise<void> => {
  return import("@tauri-apps/plugin-clipboard-manager").then((m) => m.writeText(text));
};

// Defense-in-depth: enforce a scheme allowlist before delegating to the OS
// opener. Acceptable: http(s), mailto, tel. Everything else (and notably
// javascript:/file:/data:/vbscript:) is rejected with a logged warning.
// Scheme regexes are shared with viewer link handlers via `@/lib/url-policy`.

export const openExternalUrl = (url: string): Promise<void> => {
  if (BLOCKED_LINK_SCHEME.test(url) || !EXTERNAL_LINK_SCHEME.test(url)) {
    void warn(`openExternalUrl: blocked URL scheme: ${url}`); // fire-and-forget log
    return Promise.reject(new Error(`Blocked URL scheme: ${url}`));
  }
  return openUrl(url);
};

export const restartApp = (): Promise<void> => {
  return import("@tauri-apps/plugin-process").then((m) => m.relaunch());
};

// App version (pure JS API) ───────────────────────────────────────────────

export const getAppVersion = (): Promise<string> => getVersion();
