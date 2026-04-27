import { vi } from "vitest";
import { __IPC_MOCK_EMIT } from "./__bus";
import { COMMENT_MUTATION_COMMANDS as MUTATION_COMMAND_LIST } from "@/lib/comment-mutation-commands";
import type {
  CommentThread,
  DirEntry,
  FileBadge,
  FoldRegion,
  KqlPipelineStep,
  LaunchArgs,
  MatchedComment,
  MrsfSidecar,
  SearchMatch,
  TextFileResult,
  WordSpan,
} from "@/lib/tauri-commands";

// Re-export the bus helpers so test files can import either entry point.
export { __IPC_MOCK_EMIT, __IPC_MOCK_LISTENERS_RESET } from "./__bus";

// Typed mock return values are validated at compile time against shared interfaces
type InvokeResult =
  | string
  | string[]
  | DirEntry[]
  | LaunchArgs
  | MrsfSidecar
  | CommentThread[]
  | MatchedComment[]
  | SearchMatch[]
  | FoldRegion[]
  | KqlPipelineStep[]
  | WordSpan[]
  | Record<string, FileBadge>
  | TextFileResult
  | ArrayBuffer
  | "file"
  | "dir"
  | "missing"
  | null
  | void;

// ── Launch-args queue ──────────────────────────────────────────────────────
// `get_launch_args` is a draining IPC: each frontend call shifts one entry off
// the queue. When the queue is empty the mock returns an empty LaunchArgs.
const launchArgsQueue: LaunchArgs[] = [];

export function queueLaunchArgs(values: LaunchArgs[]): void {
  launchArgsQueue.push(...values);
}

export function resetLaunchArgsMock(): void {
  launchArgsQueue.length = 0;
}

const EMPTY_LAUNCH_ARGS: LaunchArgs = { files: [], folders: [] };

// Tauri commands that mutate sidecar state and, in production, trigger a
// `comments-changed` emit downstream of `Emitter::emit_to("main", …)`.
// Mirrored here so unit tests don't need to dispatch the event manually
// after each invoke — preventing renderer subscribers from going stale
// under jsdom. Sourced from `lib/comment-mutation-commands.ts` so the
// list has a single source of truth.
const COMMENT_MUTATION_COMMANDS = new Set<string>(MUTATION_COMMAND_LIST);

export const invoke = vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<InvokeResult>>(
  async (cmd, args) => {
    const result = await defaultInvoke(cmd, args);
    if (COMMENT_MUTATION_COMMANDS.has(cmd)) {
      // Prefer camelCase (the tauri-commands.ts wrappers send `filePath`)
      // but accept snake_case for tests that hit the IPC layer raw.
      const filePath =
        (args?.filePath as string | undefined) ?? (args?.file_path as string | undefined);
      if (typeof filePath === "string" && filePath.length > 0) {
        __IPC_MOCK_EMIT("comments-changed", { file_path: filePath });
      }
    }
    return result;
  },
);

async function defaultInvoke(
  cmd: string,
  _args?: Record<string, unknown>,
): Promise<InvokeResult> {
  if (cmd === "get_launch_args") {
    return launchArgsQueue.length > 0 ? launchArgsQueue.shift()! : EMPTY_LAUNCH_ARGS;
  }
  if (cmd === "fetch_remote_asset") {
    // Default: empty 1×1 png-like blob in the prefix-encoded shape
    // (`[u32 BE: ct_len][ct_bytes][payload]`). Tests that care about
    // payload override this via mockResolvedValueOnce / mockImplementation.
    const ct = new TextEncoder().encode("image/png");
    const buf = new ArrayBuffer(4 + ct.byteLength);
    const view = new DataView(buf);
    view.setUint32(0, ct.byteLength, false);
    new Uint8Array(buf, 4).set(ct);
    return buf;
  }
  // Iter 1 / F0 defaults — return empty/no-op shapes so consumers don't
  // need to special-case them. Tests override via mockResolvedValueOnce.
  if (cmd === "get_file_badges") return {} as Record<string, FileBadge>;
  if (cmd === "get_file_comments") return [] as CommentThread[];
  if (cmd === "tokenize_words") return [] as WordSpan[];
  if (cmd === "export_review_summary") return "";
  if (cmd === "update_comment") return undefined;
  if (cmd === "set_author") return "";
  if (cmd === "get_author") return "Test User";
  // ── Two-layer mock parity (issue #135) ────────────────────────────────
  // The Playwright browser fixture (e2e/browser/fixtures/error-tracking.ts)
  // has explicit arms for these commands. Mirroring them here so a Vitest
  // and a Playwright spec running the same scenario observe the same
  // baseline shape — preventing the silent skew that broke ~50 e2e specs
  // when canonicalize_path was added (iter 3 of #89) and again when
  // get_file_comments changed shape (iter of #96). The contract is locked
  // in by src/__tests__/ipc-mock-parity.test.ts.
  if (cmd === "scan_review_files") return [] as [string, string][] as never;
  if (cmd === "update_watched_files") return undefined;
  if (cmd === "update_tree_watched_dirs") return undefined;
  if (cmd === "check_update") return null;
  if (cmd === "install_update") return null;
  if (cmd === "search_in_document") return [] as SearchMatch[];
  if (cmd === "compute_fold_regions") return [] as FoldRegion[];
  if (cmd === "parse_kql") return [] as KqlPipelineStep[];
  if (cmd === "strip_json_comments") return (_args?.text as string | undefined) ?? "";
  if (cmd === "read_text_file") {
    return { content: "", size_bytes: 0, line_count: 0 } as TextFileResult;
  }
  if (
    cmd === "cli_shim_status" ||
    cmd === "default_handler_status" ||
    cmd === "folder_context_status"
  ) {
    return "missing";
  }
  if (cmd === "onboarding_state") {
    // Cast through unknown — OnboardingState lives in tauri-commands but
    // isn't part of InvokeResult union; the runtime shape matches the
    // Playwright fixture's default.
    return { schema_version: 1, last_seen_sections: [] } as unknown as InvokeResult;
  }
  if (
    cmd === "install_cli_shim" ||
    cmd === "remove_cli_shim" ||
    cmd === "set_default_handler" ||
    cmd === "register_folder_context" ||
    cmd === "unregister_folder_context"
  ) {
    return undefined;
  }
  if (cmd === "canonicalize_path") {
    // Default: identity. Tests that exercise canonicalisation override
    // via mockResolvedValueOnce / mockImplementation.
    const p = (_args?.path as string | undefined) ?? "";
    return p;
  }
  return undefined;
}

export const convertFileSrc = vi.fn((path: string) => "asset://localhost/" + encodeURIComponent(path));
