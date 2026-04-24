import { vi } from "vitest";
import type {
  CommentThread,
  DirEntry,
  LaunchArgs,
  MatchedComment,
  MrsfSidecar,
  ParsedFrontmatter,
  SearchMatch,
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
  | ParsedFrontmatter
  | SearchMatch[]
  | Record<string, number>
  | "file"
  | "dir"
  | "missing"
  | null
  | void;

export const invoke = vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<InvokeResult>>();

export const convertFileSrc = vi.fn((path: string) => "asset://localhost/" + encodeURIComponent(path));
