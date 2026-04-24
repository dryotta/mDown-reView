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

export const setCommentResolved = (
  filePath: string,
  commentId: string,
  resolved: boolean
): Promise<void> =>
  invoke<void>("set_comment_resolved", { filePath, commentId, resolved });

export const computeAnchorHash = (text: string): Promise<string> =>
  invoke<string>("compute_anchor_hash", { text });

export const getUnresolvedCounts = (filePaths: string[]): Promise<Record<string, number>> =>
  invoke<Record<string, number>>("get_unresolved_counts", { filePaths });

// ── Document search ──────────────────────────────────────────────────────

export interface SearchMatch {
  lineIndex: number;
  startCol: number;
  endCol: number;
}

export const searchInDocument = (content: string, query: string): Promise<SearchMatch[]> =>
  invoke<SearchMatch[]>("search_in_document", { content, query });

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

export const openExternalUrl = (url: string): Promise<void> => {
  return import("@tauri-apps/plugin-opener").then((m) => m.openUrl(url));
};

export const restartApp = (): Promise<void> => {
  return import("@tauri-apps/plugin-process").then((m) => m.relaunch());
};

