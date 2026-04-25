import { vi } from "vitest";
import type {
  CommentThread,
  DirEntry,
  FoldRegion,
  KqlPipelineStep,
  LaunchArgs,
  MatchedComment,
  MrsfSidecar,
  SearchMatch,
  TextFileResult,
} from "@/lib/tauri-commands";

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
  | Record<string, number>
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

export const invoke = vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<InvokeResult>>(
  async (cmd) => {
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
    return undefined;
  },
);

export const convertFileSrc = vi.fn((path: string) => "asset://localhost/" + encodeURIComponent(path));
