import { useEffect, useRef, useState } from "react";
import { readTextFile, statFile } from "@/lib/tauri-commands";
import { getFileCategory } from "@/lib/file-types";
import { useStore } from "@/store/index";

export type FileStatus = "loading" | "ready" | "binary" | "too_large" | "image" | "error";

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

    let cancelled = false;
    readTextFile(path)
      .then((result) => {
        if (cancelled) return;
        // Functional update with byte-identical bailout: when prev already
        // reflects this exact ready state, return prev so React's Object.is
        // check skips the re-render. Frequent under AI-agent regenerate-by-
        // save where mtime advances but content/size/lineCount don't.
        setState((prev) => {
          if (
            prev.status === "ready" &&
            prev.content === result.content &&
            prev.sizeBytes === result.size_bytes &&
            prev.lineCount === result.line_count
          ) {
            return prev;
          }
          return {
            status: "ready",
            content: result.content,
            sizeBytes: result.size_bytes,
            lineCount: result.line_count,
          };
        });
        // ALWAYS call setFileMeta — mtime can advance independently of
        // content (StatusBar reads `fileMtime`). The store-level slice
        // diff in tabs.ts short-circuits when the merged meta is
        // field-by-field identical, so this is cheap when truly no-op.
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
          setState((prev) =>
            prev.status === status &&
            prev.sizeBytes === undefined &&
            prev.mtimeMs === undefined &&
            prev.content === undefined
              ? prev
              : { status }
          );
          statFile(path)
            .then((s) => {
              if (cancelled) return;
              const nextMtime = s.mtime_ms ?? null;
              setState((prev) =>
                prev.status === status &&
                prev.sizeBytes === s.size_bytes &&
                prev.mtimeMs === nextMtime
                  ? prev
                  : { status, sizeBytes: s.size_bytes, mtimeMs: nextMtime }
              );
              // Mirror the text-success path: propagate sizeBytes + mtime to
              // the FileMeta cache so StatusBar can render mtime for binary /
              // too-large files too. lineCount is intentionally omitted —
              // there's no decoded text to count lines on.
              useStore.getState().setFileMeta(path, {
                sizeBytes: s.size_bytes,
                fileMtime: s.mtime_ms ?? undefined,
              });
            })
            .catch(() => {
              /* keep placeholder without size on stat failure */
            });
        } else {
          setState((prev) =>
            prev.status === "error" && prev.error === msg
              ? prev
              : { status: "error", error: msg }
          );
        }
      });
    return () => { cancelled = true; };
  }, [path, reloadKey]);

  return state;
}
