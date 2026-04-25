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
  | { bytes: number[]; content_type: string }
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
    return undefined;
  },
);

export const convertFileSrc = vi.fn((path: string) => "asset://localhost/" + encodeURIComponent(path));
