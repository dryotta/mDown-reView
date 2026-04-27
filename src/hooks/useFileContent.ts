import { useEffect, useRef, useState } from "react";
import { readTextFile, statFile } from "@/lib/tauri-commands";
import { getFileCategory } from "@/lib/file-types";
import { useStore } from "@/store/index";

export type FileStatus = "loading" | "ready" | "binary" | "too_large" | "image" | "audio" | "video" | "pdf" | "error";

export interface FileContent {
  status: FileStatus;
  content?: string;
  /** Raw byte size of the file on disk; defined only when `status === "ready"`. */
  sizeBytes?: number;
  /** Last-modified time as epoch ms; populated for binary/too_large placeholders when stat succeeds. */
  mtimeMs?: number | null;
  /** Logical line count (per Rust `str::lines`); defined only when `status === "ready"`. */
  lineCount?: number;
  error?: string;
}

export function useFileContent(path: string): FileContent {
  const [state, setState] = useState<FileContent>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const prevPathRef = useRef(path);

  // Listen for file-changed DOM events from useFileWatcher
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { path: string; kind: string };
      if (detail.path === path && (detail.kind === "content" || detail.kind === "deleted")) {
        setReloadKey((k) => k + 1);
      }
    };
    window.addEventListener("mdownreview:file-changed", handler);
    return () => window.removeEventListener("mdownreview:file-changed", handler);
  }, [path]);

  useEffect(() => {
    const pathChanged = path !== prevPathRef.current;
    prevPathRef.current = path;

    // Show loading on initial mount or path change; skip on same-file reload to keep stale content visible
    if (reloadKey === 0 || pathChanged) {
      setState({ status: "loading" });
    }

    if (getFileCategory(path) === "image") {
      setState({ status: "image" }); // eslint-disable-line react-hooks/set-state-in-effect
      return;
    }
    if (getFileCategory(path) === "audio") {
      setState({ status: "audio" });
      return;
    }
    if (getFileCategory(path) === "video") {
      setState({ status: "video" });
      return;
    }
    if (getFileCategory(path) === "pdf") {
      setState({ status: "pdf" });
      return;
    }

    let cancelled = false;
    readTextFile(path)
      .then((result) => {
        if (cancelled) return;
        setState({
          status: "ready",
          content: result.content,
          sizeBytes: result.size_bytes,
          lineCount: result.line_count,
        });
        // Populate session-only file-meta cache so StatusBar (and any other
        // observer) can read sizeBytes/lineCount/fileMtime via store
        // selectors instead of issuing a second `read_text_file` IPC.
        useStore.getState().setFileMeta(path, {
          sizeBytes: result.size_bytes,
          lineCount: result.line_count,
          fileMtime: result.mtime_ms ?? undefined,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = String(err);
        if (msg.includes("binary_file") || msg.includes("file_too_large")) {
          const status = msg.includes("file_too_large") ? "too_large" : "binary";
          // Set placeholder status immediately so the UI doesn't sit on a
          // spinner; enrich with byte size from a follow-up stat call.
          setState({ status });
          statFile(path)
            .then((s) => {
              if (!cancelled) setState({ status, sizeBytes: s.size_bytes, mtimeMs: s.mtime_ms ?? null });
            })
            .catch(() => {
              /* keep placeholder without size on stat failure */
            });
        } else {
          setState({ status: "error", error: msg });
        }
      });
    return () => { cancelled = true; };
  }, [path, reloadKey]);

  return state;
}
