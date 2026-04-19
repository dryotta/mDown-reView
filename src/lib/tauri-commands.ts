import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";

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

export interface CommentResponse {
  author: string;
  text: string;
  createdAt: string;
}

export interface ReviewComment {
  id: string;
  anchorType: "line" | "selection" | "block"; // block kept for legacy read
  // Line anchor (always present for line/selection)
  lineNumber?: number;
  lineHash?: string;
  // Context for re-anchoring
  contextBefore?: string;
  contextAfter?: string;
  // Selection fields
  selectedText?: string;
  selectionStartOffset?: number;
  selectionEndLine?: number;
  selectionEndOffset?: number;
  // Legacy block fields (read-only, not created by new code)
  blockHash?: string;
  headingContext?: string | null;
  fallbackLine?: number;
  // Content
  text: string;
  createdAt: string;
  resolved: boolean;
  responses?: CommentResponse[];
}

export interface ReviewComments {
  version: number;
  comments: ReviewComment[];
}

// ── Typed wrappers ─────────────────────────────────────────────────────────

export const readTextFile = (path: string): Promise<string> =>
  invoke<string>("read_text_file", { path });

export const readBinaryFile = (path: string): Promise<string> =>
  invoke<string>("read_binary_file", { path });

export const readDir = (path: string): Promise<DirEntry[]> =>
  invoke<DirEntry[]>("read_dir", { path });

export const getLaunchArgs = (): Promise<LaunchArgs> =>
  invoke<LaunchArgs>("get_launch_args");

export const getLogPath = (): Promise<string> =>
  invoke<string>("get_log_path");

export const saveReviewComments = (
  filePath: string,
  comments: ReviewComment[]
): Promise<void> =>
  invoke<void>("save_review_comments", { filePath: filePath, comments });

export const loadReviewComments = (filePath: string): Promise<ReviewComments | null> =>
  invoke<ReviewComments | null>("load_review_comments", { filePath: filePath });

export const getAppVersion = (): Promise<string> => getVersion();
