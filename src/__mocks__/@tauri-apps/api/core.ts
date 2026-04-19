import { vi } from "vitest";
import type {
  DirEntry,
  LaunchArgs,
  ReviewComments,
} from "@/lib/tauri-commands";

// Typed mock return values are validated at compile time against shared interfaces
type InvokeResult =
  | string
  | string[]
  | DirEntry[]
  | LaunchArgs
  | ReviewComments
  | null
  | void;

export const invoke = vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<InvokeResult>>();

export const convertFileSrc = vi.fn((path: string) => "asset://localhost/" + encodeURIComponent(path));
