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

export interface ReviewComment {
  id: string;
  blockHash: string;
  headingContext: string | null;
  fallbackLine: number;
  text: string;
  createdAt: string;
  resolved: boolean;
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
