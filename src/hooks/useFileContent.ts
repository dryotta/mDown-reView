import { useEffect, useRef, useState } from "react";
import { readTextFile } from "@/lib/tauri-commands";
import { getFileCategory } from "@/lib/file-types";

export type FileStatus = "loading" | "ready" | "binary" | "too_large" | "image" | "error";

export interface FileContent {
  status: FileStatus;
  content?: string;
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
      .then((content) => { if (!cancelled) setState({ status: "ready", content }); })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = String(err);
        if (msg.includes("binary_file")) {
          setState({ status: "binary" });
        } else if (msg.includes("file_too_large")) {
          setState({ status: "too_large" });
        } else {
          setState({ status: "error", error: msg });
        }
      });
    return () => { cancelled = true; };
  }, [path, reloadKey]);

  return state;
}
