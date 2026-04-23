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

export interface MrsfComment {
  id: string;
  author: string;
  timestamp: string;
  text: string;
  resolved: boolean;
  line?: number;
  end_line?: number;
  start_column?: number;
  end_column?: number;
  selected_text?: string;
  anchored_text?: string;
  selected_text_hash?: string;
  commit?: string;
  type?: "suggestion" | "issue" | "question" | "accuracy" | "style" | "clarity";
  severity?: "low" | "medium" | "high";
  reply_to?: string;
}

export interface MrsfSidecar {
  mrsf_version: string;
  document: string;
  comments: MrsfComment[];
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
  document: string,
  comments: MrsfComment[]
): Promise<void> =>
  invoke<void>("save_review_comments", { filePath, document, comments });

export const loadReviewComments = (filePath: string): Promise<MrsfSidecar | null> =>
  invoke<MrsfSidecar | null>("load_review_comments", { filePath });

export const getGitHead = (path: string): Promise<string | null> =>
  invoke<string | null>("get_git_head", { path });

export interface FileChangeEvent {
  path: string;
  kind: "content" | "review" | "deleted";
}

export const updateWatchedFiles = (paths: string[]): Promise<void> =>
  invoke<void>("update_watched_files", { paths });

export const scanReviewFiles = (root: string): Promise<[string, string][]> =>
  invoke<[string, string][]>("scan_review_files", { root });

export const checkPathExists = (path: string): Promise<"file" | "dir" | "missing"> =>
  invoke<"file" | "dir" | "missing">("check_path_exists", { path });

export const computeDocumentPath = (
  filePath: string,
  root: string | null
): Promise<string> =>
  invoke<string>("compute_document_path", { filePath, root });

export const getAppVersion = (): Promise<string> => getVersion();
